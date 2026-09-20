import {
  companionSearchResultSchema,
  type CompanionSearchResult,
  type CompanionPlatform,
  type SearchIntent,
} from "@flight-lens/contracts";

const CHANNEL = "flight-lens-edge-companion";

type CompanionReply = {
  channel: typeof CHANNEL;
  direction: "to-page";
  requestId: string;
  ok: boolean;
  payload?: unknown;
  errorCode?: string;
  progress?: boolean;
};

function requestExtension(
  type: "PING" | "SEARCH",
  payload: unknown,
  timeoutMs: number,
  onProgress?: (payload: unknown) => void,
): Promise<CompanionReply | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const message = event.data as Partial<CompanionReply> | null;
      if (
        !message ||
        message.channel !== CHANNEL ||
        message.direction !== "to-page" ||
        message.requestId !== requestId
      ) return;
      if (message.progress) onProgress?.(message.payload);
      else finish(message as CompanionReply);
    };
    const finish = (value: CompanionReply | null) => {
      window.clearTimeout(timer);
      window.removeEventListener("message", receive);
      resolve(value);
    };
    window.addEventListener("message", receive);
    window.postMessage({
      channel: CHANNEL,
      direction: "to-extension",
      requestId,
      type,
      payload,
    }, window.location.origin);
  });
}

export async function searchWithEdgeCompanion(
  intent: SearchIntent,
  options: { platform?: CompanionPlatform; onResult?: (result: CompanionSearchResult) => void; onAvailable?: () => void } = {},
): Promise<CompanionSearchResult | null> {
  const ping = await requestExtension("PING", null, 350);
  if (!ping?.ok) return null;
  const capabilities = (ping.payload as { capabilities?: string[] } | undefined)?.capabilities ?? [];
  if (options.platform && !capabilities.includes("platform_retry")) {
    throw new Error("请在 Edge 扩展管理页重新加载航探扩展，并刷新航探网页后再继续该来源。");
  }
  options.onAvailable?.();
  const delivered = new Map<string, string>();
  const deliver = (payload: unknown) => {
    const parsed = companionSearchResultSchema.safeParse(payload);
    if (!parsed.success) return;
    for (const result of parsed.data.results) {
      const signature = JSON.stringify(result);
      if (delivered.get(result.platform) === signature) continue;
      delivered.set(result.platform, signature);
      options.onResult?.({ ...parsed.data, results: [result] });
    }
  };
  const response = await requestExtension("SEARCH", { intent, ...(options.platform ? { platforms: [options.platform] } : {}) }, 240_000, deliver);
  if (!response?.ok) throw new Error("部分浏览器来源未完成；已返回的结果已保留，可在来源详情中继续补查。");
  const parsed = companionSearchResultSchema.safeParse(response.payload);
  if (!parsed.success) throw new Error("浏览器来源返回了无法识别的结果，请重新加载扩展后重试。");
  deliver(parsed.data);
  return parsed.data;
}
