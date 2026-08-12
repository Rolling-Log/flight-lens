import assert from "node:assert/strict";
import test from "node:test";
import { airportCodesForLocation, companionSearchRequestSchema, createPriceAlertSchema, exchangeRateSchema, locationOptions, marketPriceInsightSchema, priceHistoryQuerySchema, priceJudgmentSchema, searchIntentSchema, searchLocations, searchMarket, userPreferencesSchema } from "../src/index.js";

test("finds canonical cities and airports by Chinese, pinyin, and IATA", () => {
  assert.equal(searchLocations("北京")[0]?.code, "BJS");
  assert.equal(searchLocations("shanghai")[0]?.code, "SHA");
  assert.equal(searchLocations("PKX")[0]?.code, "PKX");
  assert.deepEqual(airportCodesForLocation({ kind: "city", code: "BJS" }), ["PEK", "PKX"]);
  assert.deepEqual(airportCodesForLocation({ kind: "city", code: "SHA" }), ["PVG", "SHA"]);
  assert.deepEqual(airportCodesForLocation({ kind: "city", code: "CTU" }), ["CTU", "TFU"]);
});

test("normalizes Xian and Nanning examples without guessing airport codes", () => {
  const xianZh = searchLocations("西安")[0]!;
  const xianPinyin = searchLocations("xian")[0]!;
  const xianIata = searchLocations("XIY")[0]!;
  const xianAirport = searchLocations("咸阳机场")[0]!;
  const nanningAirport = searchLocations("吴圩机场")[0]!;

  assert.deepEqual([xianZh.kind, xianZh.code], ["city", "XIY"]);
  assert.deepEqual([xianPinyin.kind, xianPinyin.code], ["city", "XIY"]);
  assert.deepEqual([xianIata.kind, xianIata.code], ["airport", "XIY"]);
  assert.deepEqual([xianAirport.kind, xianAirport.code], ["airport", "XIY"]);
  assert.deepEqual([nanningAirport.kind, nanningAirport.code], ["airport", "NNG"]);
  assert.deepEqual(airportCodesForLocation(xianZh), airportCodesForLocation(xianPinyin));
  assert.deepEqual(airportCodesForLocation(xianZh), airportCodesForLocation(xianIata));
});

test("keeps a broad, internally consistent major-airport index", () => {
  const cities = locationOptions.filter((item) => item.kind === "city");
  const airports = locationOptions.filter((item) => item.kind === "airport");
  assert.ok(cities.length >= 50);
  assert.ok(airports.length >= 60);
  assert.equal(new Set(cities.map((item) => item.code)).size, cities.length);
  assert.equal(new Set(airports.map((item) => item.code)).size, airports.length);
  for (const city of cities) {
    assert.ok(city.airportCodes.length > 0);
    assert.ok(city.airportCodes.every((code) => airports.some((airport) => airport.code === code)));
  }
});

test("classifies mainland domestic and international airport pairs", () => {
  assert.equal(searchMarket({ kind: "airport", code: "PEK" }, { kind: "airport", code: "SHA" }), "domestic_cn");
  assert.equal(searchMarket({ kind: "airport", code: "PVG" }, { kind: "airport", code: "NRT" }), "international");
  assert.equal(searchMarket({ kind: "city", code: "BJS" }, { kind: "city", code: "CTU" }), "domestic_cn");
});

test("validates bounded Edge companion search evidence", () => {
  const parsed = companionSearchRequestSchema.parse({
    intent: {
      schemaVersion: "1",
      tripType: "one_way",
      origin: { kind: "airport", code: "XIY" },
      destination: { kind: "airport", code: "NNG" },
      departureDate: "2026-09-11",
    },
    companion: {
      protocolVersion: "1",
      extensionVersion: "0.1.0",
      results: [{
        platform: "qunar",
        journeys: [{
          direction: "outbound",
          state: "empty",
          bookingUrl: "https://flight.qunar.com/site/oneway_list.htm",
          fetchedAt: "2026-08-11T08:00:00.000Z",
          cards: [],
        }],
      }],
    },
  });
  assert.equal(parsed.companion.results[0]?.platform, "qunar");
});

test("round trip requires a return date", () => {
  const result = searchIntentSchema.safeParse({
    schemaVersion: "1",
    tripType: "round_trip",
    origin: { kind: "airport", code: "PVG" },
    destination: { kind: "airport", code: "NRT" },
    departureDate: "2026-08-24",
  });
  assert.equal(result.success, false);
});

test("normalizes airport and currency codes", () => {
  const result = searchIntentSchema.parse({
    schemaVersion: "1",
    tripType: "one_way",
    origin: { kind: "airport", code: "pvg" },
    destination: { kind: "airport", code: "nrt" },
    departureDate: "2026-08-24",
    budget: { amountMinor: 200000, currency: "cny" },
  });
  assert.equal(result.origin.code, "PVG");
  assert.equal(result.budget?.currency, "CNY");
});

test("rejects a return date that is not after departure", () => {
  const result = searchIntentSchema.safeParse({
    schemaVersion: "1",
    tripType: "round_trip",
    origin: { kind: "airport", code: "PVG" },
    destination: { kind: "airport", code: "NRT" },
    departureDate: "2026-08-24",
    returnDate: "2026-08-24",
  });
  assert.equal(result.success, false);
});

test("rejects an inverted time window and inconsistent direct-only stops", () => {
  const result = searchIntentSchema.safeParse({
    schemaVersion: "1",
    tripType: "one_way",
    origin: { kind: "airport", code: "PVG" },
    destination: { kind: "airport", code: "NRT" },
    departureDate: "2026-08-24",
    departureTime: { earliest: "18:00", latest: "09:00" },
    directOnly: true,
    maxStops: 1,
  });
  assert.equal(result.success, false);
});

test("accepts a custom overnight red-eye window", () => {
  const parsed = searchIntentSchema.parse({
    schemaVersion: "1",
    tripType: "one_way",
    origin: { kind: "airport", code: "PVG" },
    destination: { kind: "airport", code: "NRT" },
    departureDate: "2026-08-24",
    avoidRedEye: true,
    redEyeWindow: { start: "22:00", end: "06:00" },
  });
  assert.deepEqual(parsed.redEyeWindow, { start: "22:00", end: "06:00" });
});

test("normalizes and timestamps exchange-rate evidence", () => {
  const rate = exchangeRateSchema.parse({
    baseCurrency: "usd",
    quoteCurrency: "cny",
    rate: 7.18,
    source: "Reference FX",
    quotedAt: "2026-08-04T12:00:00+08:00",
  });
  assert.equal(rate.baseCurrency, "USD");
  assert.equal(rate.quoteCurrency, "CNY");
  assert.equal(rate.quotedAt, "2026-08-04T12:00:00+08:00");
});

test("validates V2 history, alert, and anonymous preference inputs", () => {
  const history = priceHistoryQuerySchema.parse({
    origin: "pek",
    destination: "sha",
    departureDate: "2026-09-11",
  });
  assert.equal(history.origin, "PEK");
  assert.equal(history.days, 90);

  const alert = createPriceAlertSchema.parse({
    ownerToken: "anonymous-owner-token-1234",
    intent: {
      schemaVersion: "1",
      tripType: "one_way",
      origin: { kind: "airport", code: "PEK" },
      destination: { kind: "airport", code: "SHA" },
      departureDate: "2026-09-11",
    },
    targetAmountCnyMinor: 60_000,
    ntfyTopic: "flight-lens-personal",
  });
  assert.equal(alert.checkIntervalMinutes, 360);

  const preferences = userPreferencesSchema.parse({
    ownerToken: "anonymous-owner-token-1234",
  });
  assert.deepEqual(preferences.redEyeWindow, { start: "00:00", end: "06:00" });
  assert.equal(preferences.cabin, "economy");
});

test("validates market insight and five-level judgment contracts", () => {
  const insight = marketPriceInsightSchema.parse({
    sourceId: "serpapi-google-flights",
    sourceName: "Google Flights 市场洞察",
    fetchedAt: "2026-08-12T12:00:00.000Z",
    currency: "cny",
    originCode: "PVG",
    destinationCode: "SZX",
    departureDate: "2026-09-11",
    returnDate: null,
    tripType: "one_way",
    cabin: "economy",
    adults: 1,
    priceBasis: "listed_only",
    lowestPriceMinor: 80_000,
    priceLevel: "low",
    typicalPriceRangeMinor: [90_000, 130_000],
    history: [{ date: "2026-08-01", amountMinor: 100_000 }],
  });
  assert.equal(insight.currency, "CNY");

  const judgment = priceJudgmentSchema.parse({
    status: "available",
    level: "top",
    currentAmountMinor: 80_000,
    currentPriceBasis: "listed_only",
    currency: "CNY",
    percentile: 10,
    positionPercent: 90,
    quantilesMinor: { p20: 90_000, p40: 100_000, p50: 110_000, p60: 120_000, p80: 130_000 },
    typicalPriceRangeMinor: [90_000, 130_000],
    sampleCount: 30,
    observedDayCount: 30,
    confidence: "high",
    basis: "external_history",
    explanation: "基于外部历史价格判断。",
  });
  assert.equal(judgment.level, "top");
});
