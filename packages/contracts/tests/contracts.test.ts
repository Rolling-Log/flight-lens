import assert from "node:assert/strict";
import test from "node:test";
import { searchIntentSchema } from "../src/index.js";

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
