import assert from "node:assert/strict";
import test from "node:test";
import { isOfferVisible } from "../src/offer-visibility";

test("unverified list prices cannot bypass hard search constraints", () => {
  for (const reason of ["ORIGIN_AIRPORT_CONFLICT", "DESTINATION_AIRPORT_CONFLICT",
    "OVER_BUDGET", "STOP_LIMIT_CONFLICT", "RED_EYE_CONFLICT", "CONDITIONAL_PRICE",
    "CHECKED_BAGGAGE_REQUIREMENT_UNVERIFIED", "UNKNOWN_FAILURE"]) {
    assert.equal(isOfferVisible({ comparable: false, priceVerificationStatus: "listed_only",
      incomparabilityReasons: ["PRICE_TAX_UNVERIFIED", reason] }), false);
  }
});

test("list prices with only disclosed evidence gaps remain visible", () => {
  assert.equal(isOfferVisible({ comparable: false, priceVerificationStatus: "listed_only",
    incomparabilityReasons: ["PRICE_TAX_UNVERIFIED", "SELLER_LIST_INCOMPLETE"] }), true);
  assert.equal(isOfferVisible({ comparable: true, incomparabilityReasons: [] }), true);
});

test("split tickets obey the same constraints", () => {
  assert.equal(isOfferVisible({ comparable: false, purchaseMode: "split_ticket",
    incomparabilityReasons: ["SPLIT_TICKET_SEPARATE_PURCHASES"] }), true);
  assert.equal(isOfferVisible({ comparable: false, purchaseMode: "split_ticket",
    incomparabilityReasons: ["SPLIT_TICKET_SEPARATE_PURCHASES", "OVER_BUDGET"] }), false);
});
