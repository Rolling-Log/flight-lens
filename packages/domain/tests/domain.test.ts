import assert from "node:assert/strict";
import test from "node:test";
import type { Offer } from "@flight-lens/contracts";
import {
  applyAdversarialComparability,
  applyIntentConstraints,
  deduplicateOffers,
  rankByBestBaggage,
  rankByFewestStops,
  rankByRefundFlexibility,
  rankByShortestDuration,
  reviewOffers,
  sumRequiredPriceComponents,
  validateCurrencyConversion,
  validateItineraryStructure,
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
    legs: [{
      id: "leg-1",
      segmentIds: ["segment-1"],
      origin: { kind: "airport", code: "PVG" },
      destination: { kind: "airport", code: "NRT" },
      departureAt: "2026-08-24T11:45:00+08:00",
      arrivalAt: "2026-08-24T15:55:00+09:00",
      durationMinutes: 190,
      stopCount: 0,
    }],
    segments: [
      {
        id: "segment-1",
        legIndex: 0,
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

test("blocks a mixed currency in any required price component", () => {
  const invalid = offer({
    priceComponents: [
      { kind: "base", label: "Base", amountMinor: 10000, currency: "CNY", required: true },
      { kind: "tax", label: "Tax", amountMinor: 2500, currency: "USD", required: true },
    ],
  });
  assert.deepEqual(validatePriceArithmetic(invalid), ["MIXED_COMPONENT_CURRENCY"]);
});

test("requires source and timestamp evidence for foreign-currency conversion", () => {
  const foreign = offer({
    priceComponents: [
      { kind: "base", label: "Total", amountMinor: 10000, currency: "USD", required: true },
    ],
    totalPrice: { amountMinor: 10000, currency: "USD" },
    totalPriceCny: { amountMinor: 71800, currency: "CNY" },
  });
  assert.deepEqual(validateCurrencyConversion(foreign), ["EXCHANGE_RATE_EVIDENCE_MISSING"]);
  assert.equal(
    reviewOffers([foreign], []).some(
      (finding) =>
        finding.code === "EXCHANGE_RATE_EVIDENCE_MISSING" &&
        finding.severity === "blocking",
    ),
    true,
  );

  const evidenced = offer({
    ...foreign,
    exchangeRate: {
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: 7.18,
      source: "Reference FX",
      quotedAt: "2026-08-04T12:00:00+08:00",
    },
  });
  assert.deepEqual(validateCurrencyConversion(evidenced), []);
});

test("turns conditional prices into disclosed non-comparable offers", () => {
  const conditional = offer({
    seller: {
      id: "seller",
      name: "Seller",
      kind: "ota",
      deepLink: "https://example.com/checkout",
      handoffPrecision: "exact_offer",
    },
    eligibility: ["NEW_CUSTOMER_ONLY"],
  });
  const [reviewed] = applyAdversarialComparability([conditional], []);
  assert.equal(reviewed?.comparable, false);
  assert.equal(reviewed?.incomparabilityReasons.includes("CONDITIONAL_PRICE"), true);
});

test("keeps the cheaper duplicate for one seller", () => {
  const expensive = offer({ id: "expensive", totalPrice: { amountMinor: 13000, currency: "CNY" } });
  const cheap = offer({ id: "cheap" });
  assert.equal(deduplicateOffers([expensive, cheap])[0]?.id, "cheap");
});

test("deduplicates the same itinerary and normalized seller across connectors", () => {
  const first = offer({
    id: "first",
    connectorId: "source-a",
    seller: { id: "source-a-seller", name: "Example OTA", kind: "ota" },
    totalPrice: { amountMinor: 13000, currency: "CNY" },
  });
  const second = offer({
    id: "second",
    connectorId: "source-b",
    seller: { id: "source-b-seller", name: "Example  OTA", kind: "ota" },
  });
  assert.deepEqual(deduplicateOffers([first, second]).map((item) => item.id), ["second"]);
});

test("applies budget, time, stop, red-eye, and checked-baggage rules consistently", () => {
  const constrained = applyIntentConstraints(
    [offer({
      totalPriceCny: { amountMinor: 12500, currency: "CNY" },
      baggage: [{ type: "checked", included: true, weightKg: 20 }],
    })],
    {
      schemaVersion: "1",
      tripType: "one_way",
      origin: { kind: "airport", code: "PVG" },
      destination: { kind: "airport", code: "NRT" },
      departureDate: "2026-08-24",
      flexibleDays: 0,
      adults: 1,
      cabin: "economy",
      budget: { amountMinor: 12000, currency: "CNY" },
      departureTime: { latest: "10:00" },
      directOnly: true,
      maxStops: 0,
      avoidRedEye: false,
      minimumCheckedBaggageKg: 23,
      includeNearbyAirports: false,
      explicitFields: [],
      inferredFields: [],
      pendingQuestions: [],
    },
  )[0]!;

  assert.equal(constrained.comparable, false);
  assert.equal(constrained.incomparabilityReasons.includes("OVER_BUDGET"), true);
  assert.equal(
    constrained.incomparabilityReasons.includes("DEPARTURE_AFTER_TIME_WINDOW"),
    true,
  );
  assert.equal(
    constrained.incomparabilityReasons.includes("CHECKED_BAGGAGE_REQUIREMENT_UNVERIFIED"),
    true,
  );
});

test("exposes deterministic duration, stops, baggage, and flexibility rankings", () => {
  const shortest = offer({ id: "shortest" });
  const baggage = offer({
    id: "baggage",
    legs: [{ ...offer().legs[0]!, durationMinutes: 240 }],
    baggage: [{ type: "checked", included: true, weightKg: 30 }],
    refundable: true,
    changeable: true,
  });

  assert.equal(rankByShortestDuration([baggage, shortest])[0]?.id, "shortest");
  assert.equal(rankByFewestStops([baggage, shortest])[0]?.id, "shortest");
  assert.equal(rankByBestBaggage([shortest, baggage])[0]?.id, "baggage");
  assert.equal(rankByRefundFlexibility([shortest, baggage])[0]?.id, "baggage");
});

test("does not invent baggage or flexibility winners without positive evidence", () => {
  const unknown = offer({ id: "unknown" });
  const restrictive = offer({
    id: "restrictive",
    refundable: false,
    changeable: false,
  });

  assert.deepEqual(rankByBestBaggage([unknown, restrictive]), []);
  assert.deepEqual(rankByRefundFlexibility([unknown, restrictive]), []);
});

test("blocks a supposedly comparable offer without a purchase handoff", () => {
  const candidate = offer();
  const findings = reviewOffers([{ ...candidate, comparable: true }], []);
  assert.equal(
    findings.some(
      (finding) =>
        finding.code === "NO_PURCHASE_HANDOFF" && finding.severity === "blocking",
    ),
    true,
  );
});

test("models a direct round trip as two zero-stop legs", () => {
  const outbound = offer().segments[0]!;
  const inbound = {
    ...outbound,
    id: "segment-2",
    legIndex: 1,
    origin: outbound.destination,
    destination: outbound.origin,
    departureAt: "2026-08-29T13:00:00+09:00",
    arrivalAt: "2026-08-29T16:00:00+08:00",
  };
  const roundTrip = offer({
    segments: [outbound, inbound],
    legs: [
      offer().legs[0]!,
      {
        id: "leg-2",
        segmentIds: ["segment-2"],
        origin: inbound.origin,
        destination: inbound.destination,
        departureAt: inbound.departureAt,
        arrivalAt: inbound.arrivalAt,
        durationMinutes: inbound.durationMinutes,
        stopCount: 0,
      },
    ],
  });

  assert.deepEqual(validateItineraryStructure(roundTrip), []);
  assert.deepEqual(roundTrip.legs.map((leg) => leg.stopCount), [0, 0]);
});
