import { createHash } from "node:crypto";

function envFlag(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

export function isKiroPromptCacheEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envFlag(env.KIRO_PROMPT_CACHE);
}

/**
 * Kiro's prefix cache is byte-sensitive. The per-request timestamp is only safe
 * while it is part of the current message and never replayed as history; with
 * cache mode on we omit it unless the operator explicitly opts in.
 */
export function shouldInjectKiroTimestamp(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isKiroPromptCacheEnabled(env)) return true;
  return envFlag(env.KIRO_INJECT_TIMESTAMP);
}

export function isKiroAgentContinuationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isKiroPromptCacheEnabled(env)) return false;
  return !(
    env.KIRO_AGENT_CONTINUATION_ID === "0" ||
    env.KIRO_AGENT_CONTINUATION_ID?.toLowerCase() === "false"
  );
}

/** Stable UUID-shaped continuation key derived from the deterministic conversationId. */
export function deriveKiroAgentContinuationId(conversationId: string): string {
  const hex = createHash("sha256").update(`agent-continuation:${conversationId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
