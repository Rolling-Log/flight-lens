import assert from "node:assert/strict";
import test from "node:test";
import type { MarketPriceInsight } from "@flight-lens/contracts";
import { buildHistoryChartData, buildMarketHistoryChartData } from "../src/v2-panel";

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

test("keeps external market history separate and leaves missing dates blank", () => {
  const insight: MarketPriceInsight = {
    sourceId: "serpapi-google-flights",
    sourceName: "Google Flights 市场洞察",
    fetchedAt: "2026-08-12T12:00:00.000Z",
    currency: "CNY",
    originCode: "PVG",
    destinationCode: "SZX",
    departureDate: "2026-09-11",
    returnDate: null,
    tripType: "one_way",
    cabin: "economy",
    adults: 1,
    priceBasis: "listed_only",
    lowestPriceMinor: 90_000,
    priceLevel: "typical",
    typicalPriceRangeMinor: [90_000, 130_000],
    history: [
      { date: "2026-08-10", amountMinor: 120_000 },
      { date: "2026-08-12", amountMinor: 110_000 },
    ],
  };
  const points = buildMarketHistoryChartData(insight, 3, new Date("2026-08-12T12:00:00.000Z"));
  assert.equal(points[0]?.market, 1200);
  assert.equal(points[1]?.market, undefined);
  assert.equal(points[2]?.market, 1100);
  assert.ok(points.every((point) => !Object.keys(point).some((key) => key.includes("::"))));
});
