import assert from "node:assert/strict";
import test from "node:test";
import type { Offer } from "@flight-lens/contracts";
import {
  deduplicateOffers,
  reviewOffers,
  sumRequiredPriceComponents,
  validatePriceArithmetic,
} from "../src/index.js";

function offer(overrides: Partial<Offer> = {}): Offer {
  return {
    schemaVersion: "1",
    id: "offer-1",
    sourceOfferId: "source-1",
    connectorId: "test",
    environment: "sandbox",
    seller: { id: "seller", name: "Seller", kind: "aggregator" },
    segments: [
      {
        id: "segment-1",
        marketingCarrier: "MU",
        flightNumber: "521",
        origin: { kind: "airport", code: "PVG" },
        destination: { kind: "airport", code: "NRT" },
        departureAt: "2026-08-24T11:45:00+08:00",
        arrivalAt: "2026-08-24T15:55:00+09:00",
        durationMinutes: 190,
      },
    ],
    priceComponents: [
      { kind: "base", label: "Base", amountMinor: 10000, currency: "CNY", required: true },
      { kind: "tax", label: "Tax", amountMinor: 2500, currency: "CNY", required: true },
    ],
    totalPrice: { amountMinor: 12500, currency: "CNY" },
    baggage: [],
    refundable: null,
    changeable: null,
    eligibility: [],
    fetchedAt: "2026-07-30T12:00:00+08:00",
    comparable: true,
    incomparabilityReasons: [],
    qualityScore: 90,
    ...overrides,
  };
}

test("sums required price components", () => {
  assert.equal(sumRequiredPriceComponents(offer()), 12500);
  assert.deepEqual(validatePriceArithmetic(offer()), []);
});

test("blocks a mismatched total", () => {
  const invalid = offer({ totalPrice: { amountMinor: 11000, currency: "CNY" } });
  assert.deepEqual(validatePriceArithmetic(invalid), ["TOTAL_PRICE_MISMATCH"]);
  assert.equal(reviewOffers([invalid], []).some((finding) => finding.severity === "blocking"), true);
});

test("keeps the cheaper duplicate for one seller", () => {
  const expensive = offer({ id: "expensive", totalPrice: { amountMinor: 13000, currency: "CNY" } });
  const cheap = offer({ id: "cheap" });
  assert.equal(deduplicateOffers([expensive, cheap])[0]?.id, "cheap");
});
