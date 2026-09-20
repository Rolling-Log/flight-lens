import type { SearchResponse } from "@flight-lens/contracts";
import { searchIntentSchema } from "@flight-lens/contracts";
import { summarizeSearch } from "@flight-lens/domain";

/** Replace only runners that completed a new attempt, preserving all other paths. */
export function mergeSearchResults(previous: SearchResponse | null, next: SearchResponse): SearchResponse {
  if (!previous) return next;
  if (JSON.stringify(searchIntentSchema.parse(previous.intent)) !== JSON.stringify(searchIntentSchema.parse(next.intent))) {
    throw new Error("不能合并不同条件的搜索结果。");
  }
  const updated = new Set(next.connectorReports.map((report) => report.connectorId));
  const insights = new Map(previous.marketPriceInsights.map((insight) => [insight.sourceId, insight]));
  for (const insight of next.marketPriceInsights) insights.set(insight.sourceId, insight);
  const result = summarizeSearch(next.intent,
    [...previous.offers.filter((offer) => !updated.has(offer.connectorId)), ...next.offers],
    [...previous.connectorReports.filter((report) => !updated.has(report.connectorId)), ...next.connectorReports],
    [...insights.values()], previous.requestId);
  return { ...result, audit: { configured: previous.audit.configured || next.audit.configured, persisted: false } };
}
