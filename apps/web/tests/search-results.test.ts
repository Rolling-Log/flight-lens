import assert from "node:assert/strict";
import test from "node:test";
import { searchIntentSchema, type ConnectorReport, type SearchResponse } from "@flight-lens/contracts";
import { summarizeSearch } from "@flight-lens/domain";
import { mergeSearchResults } from "../src/search-results.js";

const intent = searchIntentSchema.parse({ schemaVersion: "1", tripType: "one_way",
  origin: { kind: "airport", code: "PEK" }, destination: { kind: "airport", code: "SHA" }, departureDate: "2026-10-20" });
function report(id: string, state: ConnectorReport["state"]): ConnectorReport {
  const now = new Date().toISOString();
  return { connectorId: id, connectorName: id, state, startedAt: now, finishedAt: now,
    durationMs: 0, offerCount: 0, retryable: false, notes: [] };
}
function response(reports: ConnectorReport[]): SearchResponse {
  return { ...summarizeSearch(intent, [], reports, [], crypto.randomUUID()), audit: { configured: false, persisted: false } };
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
