import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveKiroAgentContinuationId,
  isKiroAgentContinuationEnabled,
  isKiroPromptCacheEnabled,
  shouldInjectKiroTimestamp,
} from "../../open-sse/translator/request/kiroCacheMode.ts";
import {
  createKiroCacheObservation,
  observeKiroFrame,
} from "../../open-sse/executors/kiro/cacheTelemetry.ts";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.ts";
import { extractUsage } from "../../open-sse/utils/usageTracking.ts";

test("Kiro cache mode is opt-in and controls the timestamp", () => {
  assert.equal(isKiroPromptCacheEnabled({}), false);
  assert.equal(shouldInjectKiroTimestamp({}), true);
  assert.equal(shouldInjectKiroTimestamp({ KIRO_PROMPT_CACHE: "1" }), false);
  assert.equal(
    shouldInjectKiroTimestamp({ KIRO_PROMPT_CACHE: "1", KIRO_INJECT_TIMESTAMP: "1" }),
    true
  );
});

test("agentContinuationId is only enabled with cache mode and can be disabled", () => {
  assert.equal(isKiroAgentContinuationEnabled({}), false);
  assert.equal(isKiroAgentContinuationEnabled({ KIRO_PROMPT_CACHE: "1" }), true);
  assert.equal(
    isKiroAgentContinuationEnabled({ KIRO_PROMPT_CACHE: "1", KIRO_AGENT_CONTINUATION_ID: "0" }),
    false
  );
});

test("agentContinuationId is deterministic and UUID-shaped", () => {
  const first = deriveKiroAgentContinuationId("conversation-a");
  const second = deriveKiroAgentContinuationId("conversation-a");
  const other = deriveKiroAgentContinuationId("conversation-b");
  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test("cache telemetry records cache fields without recording prompt content", () => {
  const observation = createKiroCacheObservation();
  observeKiroFrame(
    "metadataEvent",
    {
      content: "SECRET PROMPT TEXT",
      usage: {
        cacheReadInputTokens: 1024,
        cacheWriteInputTokens: 0,
        inputTokens: 2000,
        outputTokens: 7,
      },
    },
    observation
  );

  assert.equal(observation.cacheRead, 1024);
  assert.equal(observation.cacheWrite, 0);
  assert.deepEqual(observation.cacheReadKeys, ["cacheReadInputTokens"]);
  assert.deepEqual(observation.cacheWriteKeys, ["cacheWriteInputTokens"]);
  assert.equal(observation.events.metadataEvent, 1);
  assert.equal(JSON.stringify(observation).includes("SECRET PROMPT TEXT"), false);
});

test("raw-frame telemetry survives long tool-loop responses", () => {
  const observation = createKiroCacheObservation();
  for (let i = 0; i < 600; i += 1) {
    observeKiroFrame("assistantResponseEvent", { content: "x" }, observation);
  }
  observeKiroFrame("meteringEvent", { usage: 0.05 }, observation);
  assert.equal(observation.truncated, false);
  assert.equal(observation.providerCredits, 0.05);

  const overflow = createKiroCacheObservation();
  for (let i = 0; i < 1001; i += 1) {
    observeKiroFrame("assistantResponseEvent", { content: "x" }, overflow);
  }
  assert.equal(overflow.truncated, true);
});

test("provider credits survive the OpenAI to Claude usage pivot", () => {
  const state: Record<string, unknown> = { toolCalls: [] };
  openaiToClaudeResponse(
    {
      id: "chatcmpl-test",
      model: "claude-haiku-4.5",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 5,
        provider_credits: 0.05,
        cost_in_usd_ticks: 500,
      },
    },
    state
  );
  const usage = state.usage as Record<string, number>;
  assert.equal(usage.provider_credits, 0.05);
  assert.equal(usage.cost_in_usd_ticks, 500);

  const extracted = extractUsage({
    type: "message_delta",
    usage: { output_tokens: 1, provider_credits: 0.05, cost_in_usd_ticks: 500 },
  });
  assert.equal(extracted?.provider_credits, 0.05);
  assert.equal(extracted?.cost_in_usd_ticks, 500);
});
