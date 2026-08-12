import assert from "node:assert/strict";
import test from "node:test";
import type { Offer, SearchIntent } from "@flight-lens/contracts";
import { buildPriceObservationRow, isHistoricalPriceObservation } from "../src/index.js";

const intent: SearchIntent = {
  schemaVersion: "1",
  tripType: "one_way",
  origin: { kind: "airport", code: "PEK" },
  destination: { kind: "airport", code: "SHA" },
  departureDate: "2026-09-11",
  adults: 1,
  cabin: "economy",
  flexibleDays: 0,
  includeNearbyAirports: false,
  directOnly: false,
  maxStops: 1,
  avoidRedEye: false,
  minimumCheckedBaggageKg: 0,
  explicitFields: [],
  inferredFields: [],
  pendingQuestions: [],
};

function offer(overrides: Partial<Offer> = {}): Offer {
  return {
    schemaVersion: "1",
    id: "offer-1",
    sourceOfferId: "source-1",
    connectorId: "duffel-flights",
    environment: "production",
    seller: { id: "seller", name: "Seller", kind: "airline", deepLink: "https://example.com/offer", handoffPrecision: "exact_offer" },
    legs: [{ id: "leg-1", segmentIds: ["segment-1"], origin: intent.origin, destination: intent.destination, departureAt: "2026-09-11T08:00:00+08:00", arrivalAt: "2026-09-11T10:00:00+08:00", durationMinutes: 120, stopCount: 0 }],
    segments: [{ id: "segment-1", legIndex: 0, marketingCarrier: "MU", flightNumber: "5102", origin: intent.origin, destination: intent.destination, departureAt: "2026-09-11T08:00:00+08:00", arrivalAt: "2026-09-11T10:00:00+08:00", durationMinutes: 120 }],
    priceComponents: [
      { kind: "base", label: "票面价", amountMinor: 80_000, currency: "CNY", required: true },
      { kind: "tax", label: "税费", amountMinor: 5_000, currency: "CNY", required: true },
      { kind: "fuel", label: "机建燃油", amountMinor: 10_000, currency: "CNY", required: true },
      { kind: "required_service", label: "必要服务", amountMinor: 5_000, currency: "CNY", required: true },
    ],
    totalPrice: { amountMinor: 100_000, currency: "CNY" },
    totalPriceCny: { amountMinor: 100_000, currency: "CNY" },
    baggage: [],
    refundable: null,
    changeable: null,
    eligibility: [],
    fetchedAt: "2026-08-12T08:01:00.000Z",
    comparable: true,
    incomparabilityReasons: [],
    qualityScore: 90,
    priceVerificationStatus: "detail_verified",
    ...overrides,
  };
}

test("stores component amounts without merging distinct price semantics", () => {
  const row = buildPriceObservationRow(intent, "search-1", offer());
  assert.equal(row.kind, "verified_all_in");
  assert.equal(row.baseAmountMinor, 80_000);
  assert.equal(row.taxAmountMinor, 5_000);
  assert.equal(row.fuelAmountMinor, 10_000);
  assert.equal(row.requiredServiceAmountMinor, 5_000);
  assert.equal(row.totalAmountMinor, 100_000);
  assert.equal(row.inventoryFamily, "duffel-air-content");
});

test("keeps only verified, explicitly listed, or split-ticket history", () => {
  assert.equal(isHistoricalPriceObservation(offer()), true);
  assert.equal(isHistoricalPriceObservation(offer({ comparable: false, priceVerificationStatus: "listed_only" })), true);
  assert.equal(isHistoricalPriceObservation(offer({ comparable: false, purchaseMode: "split_ticket" })), true);
  assert.equal(isHistoricalPriceObservation(offer({ comparable: false, priceVerificationStatus: "unverified" })), false);
});

test("deduplicates equivalent observations inside one five-minute bucket", () => {
  const first = buildPriceObservationRow(intent, "search-1", offer());
  const second = buildPriceObservationRow(intent, "search-2", offer({ fetchedAt: "2026-08-12T08:04:59.000Z" }));
  const later = buildPriceObservationRow(intent, "search-3", offer({ fetchedAt: "2026-08-12T08:05:00.000Z" }));
  assert.equal(first.dedupeKey, second.dedupeKey);
  assert.notEqual(first.dedupeKey, later.dedupeKey);
});
