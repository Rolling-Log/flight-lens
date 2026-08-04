import type { ConnectorReport, Offer } from "@flight-lens/contracts";

type StatusOffer = Pick<Offer, "environment">;
type StatusReport = Pick<ConnectorReport, "state" | "notes">;

export type ResultSourceStatus = {
  label: string;
  productionStyle: boolean;
};

export function resultSourceStatus(
  offers: readonly StatusOffer[],
  reports: readonly StatusReport[],
): ResultSourceStatus {
  const usesStaleCache = reports.some((report) =>
    report.notes.some((note) => note.startsWith("CACHE_STALE_FALLBACK:")),
  );
  if (usesStaleCache) {
    return {
      label: "实时来源失败 · 已披露旧缓存降级",
      productionStyle: false,
    };
  }

  const usesFreshCache = reports.some((report) =>
    report.notes.some((note) => note.startsWith("CACHE_HIT:")),
  );
  if (usesFreshCache) {
    return {
      label: "生产来源 · 已披露新鲜缓存",
      productionStyle: true,
    };
  }

  if (offers.some((offer) => offer.environment === "production")) {
    return { label: "实时生产来源", productionStyle: true };
  }
  if (reports.some((report) => report.state === "timeout")) {
    return { label: "来源超时 · 未返回报价", productionStyle: false };
  }
  if (reports.some((report) => !["success", "empty"].includes(report.state))) {
    return { label: "来源失败 · 未返回报价", productionStyle: false };
  }
  if (reports.length > 0) {
    return { label: "来源已完成 · 无符合报价", productionStyle: false };
  }
  return { label: "Sandbox 来源 · 不代表可购买库存", productionStyle: false };
}
