type JsonRecord = Record<string, unknown>;

export type KiroCacheObservation = {
  events: Record<string, number>;
  frames: number;
  truncated: boolean;
  cacheRead?: number;
  cacheWrite?: number;
  inputTokens?: number;
  outputTokens?: number;
  providerCredits?: number;
  costUsdTicks?: number;
  contextUsagePercentage?: number;
  cacheReadKeys: string[];
  cacheWriteKeys: string[];
};

const MAX_OBSERVED_FRAMES = 200;

const CACHE_READ_KEYS = [
  "cacheReadInputTokens",
  "cacheReadTokens",
  "cache_read_input_tokens",
] as const;
const CACHE_WRITE_KEYS = [
  "cacheWriteInputTokens",
  "cacheCreationTokens",
  "cache_creation_input_tokens",
] as const;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function observeMetrics(metrics: JsonRecord | null, observation: KiroCacheObservation): void {
  if (!metrics) return;
  for (const key of CACHE_READ_KEYS) {
    if (typeof metrics[key] === "number") {
      observation.cacheRead = metrics[key] as number;
      if (!observation.cacheReadKeys.includes(key)) observation.cacheReadKeys.push(key);
    }
  }
  for (const key of CACHE_WRITE_KEYS) {
    if (typeof metrics[key] === "number") {
      observation.cacheWrite = metrics[key] as number;
      if (!observation.cacheWriteKeys.includes(key)) observation.cacheWriteKeys.push(key);
    }
  }
  if (typeof metrics.inputTokens === "number") observation.inputTokens = metrics.inputTokens;
  if (typeof metrics.outputTokens === "number") observation.outputTokens = metrics.outputTokens;
  if (typeof metrics.prompt_tokens === "number") observation.inputTokens = metrics.prompt_tokens;
  if (typeof metrics.completion_tokens === "number") {
    observation.outputTokens = metrics.completion_tokens;
  }
  if (typeof metrics.contextUsagePercentage === "number") {
    observation.contextUsagePercentage = metrics.contextUsagePercentage;
  }
  if (typeof metrics.provider_credits === "number") {
    observation.providerCredits = metrics.provider_credits;
  }
  if (typeof metrics.cost_in_usd_ticks === "number") {
    observation.costUsdTicks = metrics.cost_in_usd_ticks;
  }
}

export function isKiroCacheTelemetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.KIRO_CACHE_TELEMETRY_DEBUG === "1" || env.KIRO_CACHE_TELEMETRY_DEBUG === "true";
}

export function createKiroCacheObservation(): KiroCacheObservation {
  return { events: {}, frames: 0, truncated: false, cacheReadKeys: [], cacheWriteKeys: [] };
}

export function observeKiroFrame(
  eventType: string,
  payload: unknown,
  observation: KiroCacheObservation | undefined
): void {
  if (!observation) return;
  observation.frames += 1;
  if (observation.frames > MAX_OBSERVED_FRAMES) {
    observation.truncated = true;
    return;
  }

  const type = eventType || "unknown";
  observation.events[type] = (observation.events[type] ?? 0) + 1;

  const record = asRecord(payload);
  if (!record) return;
  observeMetrics(record, observation);
  observeMetrics(asRecord(record.metricsEvent), observation);
  observeMetrics(asRecord(record.metadataEvent), observation);
  observeMetrics(asRecord(record.metadataEvent)?.usage as JsonRecord | undefined, observation);

  const usageRecord = asRecord(record.usage);
  if (usageRecord) {
    observeMetrics(usageRecord, observation);
  } else if (type === "meteringEvent" && typeof record.usage === "number") {
    observation.providerCredits = record.usage;
  }
}

export function logKiroCacheObservation(
  observation: KiroCacheObservation | undefined,
  meta: Record<string, unknown>
): void {
  if (!observation || !isKiroCacheTelemetryEnabled()) return;
  console.info(
    "[KIRO_CACHE] " +
      JSON.stringify({
        ...meta,
        frames: observation.frames,
        truncated: observation.truncated,
        events: observation.events,
        cacheRead: observation.cacheRead ?? null,
        cacheWrite: observation.cacheWrite ?? null,
        cacheReadKeys: observation.cacheReadKeys,
        cacheWriteKeys: observation.cacheWriteKeys,
        inputTokens: observation.inputTokens ?? null,
        outputTokens: observation.outputTokens ?? null,
        providerCredits: observation.providerCredits ?? null,
        costUsdTicks: observation.costUsdTicks ?? null,
        contextUsagePercentage: observation.contextUsagePercentage ?? null,
      })
  );
}
