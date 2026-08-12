import {
  companionSearchResultSchema,
  type CompanionSearchResult,
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
};

function requestExtension(
  type: "PING" | "SEARCH",
  payload: unknown,
  timeoutMs: number,
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
      finish(message as CompanionReply);
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
): Promise<CompanionSearchResult | null> {
  const ping = await requestExtension("PING", null, 350);
  if (!ping?.ok) return null;
  const response = await requestExtension("SEARCH", { intent }, 100_000);
  if (!response?.ok) return null;
  const parsed = companionSearchResultSchema.safeParse(response.payload);
  return parsed.success ? parsed.data : null;
}
