import type { Offer } from "@flight-lens/contracts";

const disclosedEvidenceGaps = new Set([
  "PRICE_TAX_UNVERIFIED",
  "SELLER_LIST_INCOMPLETE",
  "SPLIT_TICKET_SEPARATE_PURCHASES",
]);

export function isOfferVisible(offer: Pick<Offer,
  "comparable" | "purchaseMode" | "priceVerificationStatus" | "incomparabilityReasons"
>): boolean {
  const displayable = offer.comparable || offer.purchaseMode === "split_ticket" ||
    offer.priceVerificationStatus === "listed_only";
  // A disclosed list price may lack tax evidence, but still must respect the
  // user's airport, time, budget, stops, baggage, and eligibility constraints.
  return displayable && offer.incomparabilityReasons.every((reason) => disclosedEvidenceGaps.has(reason));
}
