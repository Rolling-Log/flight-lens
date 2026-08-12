import assert from "node:assert/strict";
import test from "node:test";
import { calculatePriceDeviation } from "../src/index.js";

test("calculates a signed price delta and absolute basis points", () => {
  assert.deepEqual(calculatePriceDeviation(100_000, 101_000), {
    deltaMinor: 1_000,
    absoluteBasisPoints: 100,
  });
  assert.deepEqual(calculatePriceDeviation(100_000, 99_500), {
    deltaMinor: -500,
    absoluteBasisPoints: 50,
  });
});

test("rejects unsafe or invalid price observations", () => {
  assert.throws(() => calculatePriceDeviation(0, 100), /Expected amount/);
  assert.throws(() => calculatePriceDeviation(100, -1), /Observed amount/);
  assert.throws(
    () => calculatePriceDeviation(Number.MAX_SAFE_INTEGER + 1, 100),
    /Expected amount/,
  );
});
