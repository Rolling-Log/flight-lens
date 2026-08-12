import assert from "node:assert/strict";
import test from "node:test";
import { buildHistoryChartData } from "../src/v2-panel";

const observation = (observedAt: string, amount: number, sellerId = "seller-1") => ({
  observedAt,
  observationKind: "listed_only" as const,
  totalAmountCnyMinor: amount,
  sellerId,
  sellerName: sellerId,
} as Parameters<typeof buildHistoryChartData>[0][number]);

test("builds a real daily window and aggregates same-day observations", () => {
  const points = buildHistoryChartData([
    observation("2026-08-10T02:00:00.000Z", 120000),
    observation("2026-08-10T02:01:00.000Z", 115000),
    observation("2026-08-12T02:00:00.000Z", 130000),
  ], 3, new Date("2026-08-12T12:00:00.000Z"));

  assert.deepEqual(points.map((point) => point.label), ["08/10", "08/11", "08/12"]);
  assert.equal(points[0]["listed_only::seller-1"], 1150);
  assert.equal(points[1]["listed_only::seller-1"], undefined);
  assert.equal(points[2]["listed_only::seller-1"], 1300);
});
