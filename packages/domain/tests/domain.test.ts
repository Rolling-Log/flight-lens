import assert from "node:assert/strict";
import test from "node:test";
import type { MarketPriceInsight, Offer, SearchIntent } from "@flight-lens/contracts";
import {
  analyzePriceTrend,
  assessPriceJudgment,
  applyAdversarialComparability,
  applyIntentConstraints,
  deduplicateOffers,
  rankByBestBaggage,
  rankByFewestStops,
  rankByLowestSplitPrice,
  rankByRefundFlexibility,
  rankByShortestDuration,
  reviewOffers,
  sumRequiredPriceComponents,
  validateCurrencyConversion,
  validateItineraryStructure,
  validatePriceArithmetic,
  planBoundedSearch,
} from "../src/index.js";

const judgmentIntent: SearchIntent = {
  schemaVersion: "1",
  tripType: "one_way",
  origin: { kind: "airport", code: "PVG" },
  destination: { kind: "airport", code: "SZX" },
  departureDate: "2026-09-11",
  flexibleDays: 0,
  adults: 1,
  cabin: "economy",
  directOnly: false,
  maxStops: 1,
  avoidRedEye: false,
  minimumCheckedBaggageKg: 0,
  includeNearbyAirports: false,
  explicitFields: [],
  inferredFields: [],
  pendingQuestions: [],
};

function marketInsight(overrides: Partial<MarketPriceInsight> = {}): MarketPriceInsight {
  return {
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
    lowestPriceMinor: 70_000,
    priceLevel: "low",
    typicalPriceRangeMinor: [90_000, 130_000],
    history: [70, 80, 90, 100, 110, 120, 130, 140, 150, 160].map((amount, index) => ({
      date: `2026-08-${String(index + 1).padStart(2, "0")}`,
      amountMinor: amount * 1_000,
    })),
    ...overrides,
  };
}

test("assigns five price levels with boundary values entering the better level", () => {
  const cases = [
    [70_000, "top"],
    [90_000, "excellent"],
    [110_000, "standard"],
    [130_000, "npc"],
    [170_000, "terrible"],
  ] as const;
  for (const [currentAmountMinor, expected] of cases) {
    const judgment = assessPriceJudgment({
      currentAmountMinor,
      currentPriceBasis: "listed_only",
      currency: "CNY",
      intent: judgmentIntent,
      marketInsight: marketInsight(),
    });
    assert.equal(judgment.level, expected);
  }
});

test("refuses mismatched price semantics and uses typical range only as low confidence fallback", () => {
  const mismatch = assessPriceJudgment({
    currentAmountMinor: 80_000,
    currentPriceBasis: "verified_all_in",
    currency: "CNY",
    intent: judgmentIntent,
    marketInsight: marketInsight(),
  });
  assert.equal(mismatch.status, "unavailable");

  const routeMismatch = assessPriceJudgment({
    currentAmountMinor: 80_000,
    currentPriceBasis: "listed_only",
    currency: "CNY",
    intent: judgmentIntent,
    marketInsight: marketInsight({ destinationCode: "CAN" }),
  });
  assert.equal(routeMismatch.status, "unavailable");

  const fallback = assessPriceJudgment({
    currentAmountMinor: 80_000,
    currentPriceBasis: "listed_only",
    currency: "CNY",
    intent: judgmentIntent,
    marketInsight: marketInsight({ history: [] }),
  });
  assert.equal(fallback.status, "available");
  assert.equal(fallback.basis, "typical_range");
  assert.equal(fallback.confidence, "low");

  const split = assessPriceJudgment({
    currentAmountMinor: 80_000,
    currentPriceBasis: "split_ticket",
    currency: "CNY",
    intent: judgmentIntent,
    marketInsight: marketInsight(),
  });
  assert.equal(split.status, "unavailable");
});

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

test("keeps split and single-ticket offers as separate products", () => {
  const single = offer({ id: "single" });
  const split = offer({
    id: "split",
    purchaseMode: "split_ticket",
    totalPrice: { amountMinor: 10000, currency: "CNY" },
  });
  assert.deepEqual(deduplicateOffers([single, split]).map((item) => item.id), ["single", "split"]);
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

test("uses a custom red-eye window and supports overnight windows", () => {
  const candidate = offer({
    legs: [{ ...offer().legs[0]!, departureAt: "2026-08-24T05:30:00+08:00" }],
    segments: [{ ...offer().segments[0]!, departureAt: "2026-08-24T05:30:00+08:00" }],
  });
  const constrained = applyIntentConstraints([candidate], {
    schemaVersion: "1",
    tripType: "one_way",
    origin: { kind: "airport", code: "PVG" },
    destination: { kind: "airport", code: "NRT" },
    departureDate: "2026-08-24",
    flexibleDays: 0,
    adults: 1,
    cabin: "economy",
    directOnly: false,
    maxStops: 1,
    avoidRedEye: true,
    redEyeWindow: { start: "05:00", end: "07:00" },
    minimumCheckedBaggageKg: 0,
    includeNearbyAirports: false,
    explicitFields: [],
    inferredFields: [],
    pendingQuestions: [],
  })[0]!;
  assert.ok(constrained.incomparabilityReasons.includes("RED_EYE_CONFLICT"));
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

test("blocks offers whose actual airport conflicts with an airport-specific search", () => {
  const mismatched = offer({
    legs: [{
      ...offer().legs[0]!,
      destination: { kind: "airport", code: "PVG" },
    }],
  });
  const constrained = applyIntentConstraints([mismatched], {
    schemaVersion: "1",
    tripType: "one_way",
    origin: { kind: "airport", code: "PVG" },
    destination: { kind: "airport", code: "NRT" },
    departureDate: "2026-08-24",
    flexibleDays: 0,
    adults: 1,
    cabin: "economy",
    directOnly: false,
    maxStops: 1,
    avoidRedEye: false,
    minimumCheckedBaggageKg: 0,
    includeNearbyAirports: false,
    explicitFields: [],
    inferredFields: [],
    pendingQuestions: [],
  })[0]!;

  assert.equal(constrained.comparable, false);
  assert.equal(constrained.incomparabilityReasons.includes("DESTINATION_AIRPORT_CONFLICT"), true);
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

test("blocks a listed-only source price from the verifiable all-in comparison", () => {
  const candidate = offer({
    seller: {
      id: "seller",
      name: "Seller",
      kind: "ota",
      deepLink: "https://example.com/results",
      handoffPrecision: "search_results",
    },
    priceVerificationStatus: "listed_only",
  });
  const [reviewed] = applyAdversarialComparability([candidate], []);
  assert.equal(reviewed?.comparable, false);
  assert.ok(reviewed?.incomparabilityReasons.includes("PRICE_TAX_UNVERIFIED"));
});

test("ranks split tickets separately by their combined displayed price", () => {
  const expensive = offer({
    id: "split-expensive",
    purchaseMode: "split_ticket",
    totalPrice: { amountMinor: 15000, currency: "CNY" },
  });
  const cheap = offer({
    id: "split-cheap",
    purchaseMode: "split_ticket",
  });
  assert.deepEqual(rankByLowestSplitPrice([expensive, cheap]).map((item) => item.id), [
    "split-cheap",
    "split-expensive",
  ]);
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

test("reports insufficient trend data and filters a large outlier", () => {
  const insufficient = analyzePriceTrend([
    { amountMinor: 100_000, observedAt: "2026-08-01T00:00:00Z" },
    { amountMinor: 98_000, observedAt: "2026-08-02T00:00:00Z" },
  ]);
  assert.equal(insufficient.direction, "insufficient_data");

  const trend = analyzePriceTrend([
    { amountMinor: 120_000, observedAt: "2026-08-01T00:00:00Z" },
    { amountMinor: 118_000, observedAt: "2026-08-02T00:00:00Z" },
    { amountMinor: 117_000, observedAt: "2026-08-03T00:00:00Z" },
    { amountMinor: 95_000, observedAt: "2026-08-04T00:00:00Z" },
    { amountMinor: 94_000, observedAt: "2026-08-05T00:00:00Z" },
    { amountMinor: 900_000, observedAt: "2026-08-06T00:00:00Z" },
  ]);
  assert.equal(trend.direction, "falling");
  assert.equal(trend.outlierCount, 1);
  assert.equal(trend.currentAmountMinor, 94_000);
});

test("counts same-day offers as one daily price observation", () => {
  const trend = analyzePriceTrend([
    { amountMinor: 120_000, observedAt: "2026-08-01T09:00:00Z" },
    { amountMinor: 115_000, observedAt: "2026-08-01T09:01:00Z" },
    { amountMinor: 110_000, observedAt: "2026-08-02T09:00:00Z" },
  ]);

  assert.equal(trend.direction, "insufficient_data");
  assert.equal(trend.sampleCount, 2);
  assert.equal(trend.historicalLowAmountMinor, 110_000);
  assert.match(trend.explanation, /2 个观测日/);
});

test("bounds flexible-date and nearby-airport exploration", () => {
  const plan = planBoundedSearch({
    schemaVersion: "1",
    tripType: "round_trip",
    origin: { kind: "city", code: "BJS" },
    destination: { kind: "city", code: "SHA" },
    departureDate: "2026-09-11",
    returnDate: "2026-09-16",
    flexibleDays: 3,
    adults: 1,
    cabin: "economy",
    directOnly: false,
    maxStops: 1,
    avoidRedEye: false,
    minimumCheckedBaggageKg: 0,
    includeNearbyAirports: true,
    explicitFields: [],
    inferredFields: [],
    pendingQuestions: [],
  }, 5);
  assert.equal(plan.intents.length, 5);
  assert.equal(plan.stoppedReason, "combination_budget_reached");
  assert.ok(plan.intents.every((intent) => intent.flexibleDays === 0));
  assert.ok(plan.intents.every((intent) => intent.includeNearbyAirports === false));
  assert.ok(plan.exploredOrigins.every((code) => ["PEK", "PKX"].includes(code)));
});
