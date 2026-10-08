import type { ConnectorReport, SearchResponse } from "@flight-lens/contracts";
import { searchIntentSchema } from "@flight-lens/contracts";
import { summarizeSearch } from "@flight-lens/domain";

/** Replace only the reported runners, preserving all other paths and their offers. */
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

/** Starting a new attempt invalidates that source's old prices, not other sources. */
export function replaceSourceReports(previous: SearchResponse, reports: ConnectorReport[]): SearchResponse {
  return mergeSearchResults(previous, {
    ...summarizeSearch(previous.intent, [], reports, [], previous.requestId),
    audit: { configured: false, persisted: false },
  });
}

/** A failed bridge or mapping request must leave a retryable terminal report. */
export function finishUnfinishedSources(response: SearchResponse, finishedAt = new Date().toISOString()): SearchResponse {
  const unfinished = response.connectorReports.filter((report) => ["pending", "searching"].includes(report.state));
  if (!unfinished.length) return response;
  return replaceSourceReports(response, unfinished.map((report) => ({
    ...report,
    state: "unavailable",
    finishedAt,
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(report.startedAt)),
    offerCount: 0,
    retryable: true,
    errorCode: "COMPANION_RESULT_INCOMPLETE",
    notes: ["COMPANION_RETRY_AVAILABLE"],
  })));
}

export function emptySearchMessage(result: SearchResponse, searching: boolean): { title: string; description: string } {
  if (searching || result.disclosure.pendingSources > 0) {
    return { title: "搜索仍在进行，暂未收到可显示的报价", description: "正在等待其他来源返回。现在还不能判断是否有符合条件的机票。" };
  }
  if (result.offers.length > 0) {
    return { title: "当前筛选条件下没有可显示的报价", description: "已收到报价，但被机场、直飞、行李或其他条件排除。可重置页面筛选或调整搜索条件。" };
  }
  const failed = result.disclosure.failedSources + result.disclosure.timedOutSources;
  if (failed > 0) {
    return result.disclosure.successfulSources > 0
      ? { title: "已响应的来源没有可显示报价，仍有来源失败", description: "本轮搜索不完整。请在“来源”中查看失败原因并单独重试，再判断是否需要调整条件。" }
      : { title: "来源未成功返回，暂时无法判断是否有合适机票", description: "请在“来源”中查看失败原因并重试；来源失败不表示没有机票。" };
  }
  return result.disclosure.successfulSources > 0
    ? { title: "已响应的来源没有返回可显示报价", description: "可以调整日期、直飞或行李条件后重试。空返回不代表其他平台也没有机票。" }
    : { title: "暂无可用来源返回报价", description: "请在“来源”中检查连接状态，以及各入口是否支持当前搜索条件。" };
}

export function sourceServiceNotice(report: ConnectorReport): string | null {
  if (report.errorCode === "QUNAR_COMPANION_WEB_SERVICE_ENDED") {
    return "去哪儿网页版机票服务已停止，重新登录不能恢复。请使用去哪儿旅行 App 或其他来源。";
  }
  if (report.connectorId !== "qunar-edge-companion") return null;
  const scheduled = [report.errorCode ?? "", ...report.notes].join(" ").match(/SERVICE_SUNSET_SCHEDULED_(\d{2})_(\d{2})/);
  return scheduled
    ? `去哪儿公告：网页版机票查询及预订服务将于${Number(scheduled[1])}月${Number(scheduled[2])}日起停止。请关注去哪儿旅行 App 或其他来源。`
    : null;
}
