import assert from "node:assert/strict";
import test from "node:test";
import { searchIntentSchema, type ConnectorReport, type Offer, type SearchResponse } from "@flight-lens/contracts";
import { summarizeSearch } from "@flight-lens/domain";
import { emptySearchMessage, finishUnfinishedSources, mergeSearchResults, replaceSourceReports, sourceServiceNotice } from "../src/search-results.js";

const intent = searchIntentSchema.parse({ schemaVersion: "1", tripType: "one_way",
  origin: { kind: "airport", code: "PEK" }, destination: { kind: "airport", code: "SHA" }, departureDate: "2026-10-20" });
function report(id: string, state: ConnectorReport["state"]): ConnectorReport {
  const now = new Date().toISOString();
  return { connectorId: id, connectorName: id, state, startedAt: now, finishedAt: now,
    durationMs: 0, offerCount: 0, retryable: false, notes: [] };
}
function response(reports: ConnectorReport[], offers: Offer[] = []): SearchResponse {
  return { ...summarizeSearch(intent, offers, reports, [], crypto.randomUUID()), audit: { configured: false, persisted: false } };
}

function offer(connectorId: string, amountMinor: number): Offer {
  const route = { origin: { kind: "airport" as const, code: "PEK" }, destination: { kind: "airport" as const, code: "SHA" },
    departureAt: "2026-10-20T08:00:00+08:00", arrivalAt: "2026-10-20T10:00:00+08:00", durationMinutes: 120 };
  return { schemaVersion: "1", id: `${connectorId}-offer`, sourceOfferId: "offer", connectorId, environment: "production",
    seller: { id: connectorId, name: connectorId, kind: "ota", deepLink: "https://example.test/flight" },
    legs: [{ ...route, id: "leg", segmentIds: ["segment"], stopCount: 0 }],
    segments: [{ ...route, id: "segment", legIndex: 0, marketingCarrier: "MU", flightNumber: "5100" }],
    priceComponents: [{ kind: "base", label: "含税全价", amountMinor, currency: "CNY", required: true }],
    totalPrice: { amountMinor, currency: "CNY" }, baggage: [], refundable: null, changeable: null, eligibility: [],
    fetchedAt: "2026-10-08T08:00:00Z", comparable: true, incomparabilityReasons: [], qualityScore: 80 };
}

test("incremental replies retain independent cloud and waiting browser paths", () => {
  const pending = response([report("ctrip-edge-companion", "searching"), report("qunar-edge-companion", "searching")]);
  const withCloud = mergeSearchResults(pending, response([report("fliggy-flyai", "success")]));
  assert.equal(withCloud.disclosure.pendingSources, 2);
  assert.equal(withCloud.disclosure.failedSources, 0);
  const blocked = mergeSearchResults(withCloud, response([report("ctrip-edge-companion", "login_required")]));
  assert.equal(blocked.disclosure.pendingSources, 1);
  assert.equal(blocked.disclosure.failedSources, 1);
  const retried = mergeSearchResults(blocked, response([report("ctrip-edge-companion", "success")]));
  assert.equal(retried.connectorReports.length, 3);
  assert.equal(retried.disclosure.successfulSources, 2);
  assert.equal(retried.disclosure.failedSources, 0);
});

test("different queries cannot accidentally merge late responses", () => {
  const old = response([]);
  const next = response([]);
  next.intent = { ...next.intent, departureDate: "2026-10-21" };
  assert.throws(() => mergeSearchResults(old, next), /不同条件/);
});

test("retry invalidates only its source's old price and a mapping failure ends pending coverage", () => {
  const cloud = offer("cloud", 60000);
  const browser = offer("qunar-edge-companion", 50000);
  const original = response([report("cloud", "success"), report(browser.connectorId, "success")], [cloud, browser]);
  const retry = replaceSourceReports(original, [{ ...report(browser.connectorId, "searching"), startedAt: "2026-10-08T08:00:00Z" }]);
  assert.deepEqual(retry.offers.map((value) => value.id), [cloud.id]);
  assert.equal(retry.lowestComparableOfferId, cloud.id);
  assert.equal(retry.disclosure.pendingSources, 1);
  assert.equal(retry.disclosure.failedSources, 0);
  const failed = finishUnfinishedSources(retry, "2026-10-08T08:00:03Z");
  assert.equal(failed.disclosure.pendingSources, 0);
  assert.equal(failed.disclosure.failedSources, 1);
  assert.equal(failed.connectorReports.find((value) => value.connectorId === browser.connectorId)?.durationMs, 3000);
  assert.equal(failed.connectorReports.find((value) => value.connectorId === browser.connectorId)?.retryable, true);
  assert.deepEqual(failed.offers, retry.offers);
  assert.deepEqual(failed.connectorReports[0], original.connectorReports[0]);
  const recovered = mergeSearchResults(failed, response([report(browser.connectorId, "success")], [browser]));
  assert.equal(recovered.disclosure.successfulSources, 2);
  assert.equal(recovered.disclosure.failedSources, 0);
  assert.equal(recovered.lowestComparableOfferId, browser.id);
});

test("empty results distinguish waiting, filtered prices, failed coverage and successful empty replies", () => {
  const successful = response([report("cloud", "empty")]);
  assert.match(emptySearchMessage(successful, true).title, /搜索仍在进行/);
  assert.match(emptySearchMessage(response([report("browser", "searching")]), false).title, /搜索仍在进行/);
  assert.match(emptySearchMessage(response([report("cloud", "success")], [offer("cloud", 50000)]), false).title, /筛选条件/);
  assert.match(emptySearchMessage(response([report("cloud", "timeout")]), false).title, /未成功返回/);
  assert.match(emptySearchMessage(response([report("cloud", "empty"), report("browser", "unavailable")]), false).title, /仍有来源失败/);
  assert.match(emptySearchMessage(successful, false).title, /已响应的来源没有返回/);
  assert.doesNotMatch(JSON.stringify(emptySearchMessage(successful, false)), /已完成核验/);
  assert.match(emptySearchMessage(response([report("cloud", "unsupported_query")]), false).title, /暂无可用来源/);
});

test("service notices distinguish an announced future sunset from an explicitly ended service", () => {
  const source = report("qunar-edge-companion", "success");
  const announcement = sourceServiceNotice({ ...source, notes: ["BROWSER_COVERAGE:outbound:unknown:11:CITY_SCOPE_POST_FILTER_SERVICE_SUNSET_SCHEDULED_10_10"] });
  assert.match(announcement ?? "", /将于10月10日起停止/);
  assert.doesNotMatch(announcement ?? "", /已停止/);
  assert.equal(sourceServiceNotice({ ...source, state: "login_required", errorCode: "QUNAR_COMPANION_LOGIN_REQUIRED_SERVICE_SUNSET_SCHEDULED_10_10" }), announcement);
  assert.match(sourceServiceNotice({ ...source, state: "unavailable", errorCode: "QUNAR_COMPANION_WEB_SERVICE_ENDED" }) ?? "", /已停止，重新登录不能恢复/);
  assert.equal(sourceServiceNotice(source), null);
});
