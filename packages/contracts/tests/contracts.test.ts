import assert from "node:assert/strict";
import test from "node:test";
import { airportCodesForLocation, exchangeRateSchema, searchIntentSchema, searchLocations } from "../src/index.js";

test("finds canonical cities and airports by Chinese, pinyin, and IATA", () => {
  assert.equal(searchLocations("北京")[0]?.code, "BJS");
  assert.equal(searchLocations("shanghai")[0]?.code, "SHA");
  assert.equal(searchLocations("PKX")[0]?.code, "PKX");
  assert.deepEqual(airportCodesForLocation({ kind: "city", code: "BJS" }), ["PEK", "PKX"]);
  assert.deepEqual(airportCodesForLocation({ kind: "city", code: "SHA" }), ["PVG", "SHA"]);
  assert.deepEqual(airportCodesForLocation({ kind: "city", code: "CTU" }), ["CTU", "TFU"]);
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
