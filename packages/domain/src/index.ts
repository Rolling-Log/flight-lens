import type { ConnectorReport, Offer } from "@flight-lens/contracts";

export function sumRequiredPriceComponents(offer: Offer): number {
  return offer.priceComponents.reduce((total, component) => {
    if (!component.required) return total;
    return component.kind === "discount"
      ? total - component.amountMinor
      : total + component.amountMinor;
  }, 0);
}

export function validatePriceArithmetic(offer: Offer): string[] {
  const issues: string[] = [];
  const calculated = sumRequiredPriceComponents(offer);
  if (calculated !== offer.totalPrice.amountMinor) {
    issues.push("TOTAL_PRICE_MISMATCH");
  }
  if (offer.totalPrice.currency !== offer.priceComponents[0]?.currency) {
    issues.push("MIXED_COMPONENT_CURRENCY");
  }
  return issues;
}

export function offerFingerprint(offer: Offer): string {
  return offer.segments
    .map((segment) =>
      [
        segment.operatingCarrier ?? segment.marketingCarrier,
        segment.flightNumber,
        segment.origin.code,
        segment.destination.code,
        segment.departureAt,
      ].join(":"),
    )
    .join("|");
}

export function deduplicateOffers(offers: readonly Offer[]): Offer[] {
  const byFingerprintAndSeller = new Map<string, Offer>();
  for (const offer of offers) {
    const key = `${offerFingerprint(offer)}::${offer.seller.id}`;
    const current = byFingerprintAndSeller.get(key);
    if (!current || offer.totalPrice.amountMinor < current.totalPrice.amountMinor) {
      byFingerprintAndSeller.set(key, offer);
    }
  }
  return [...byFingerprintAndSeller.values()];
}

export function rankByLowestComparablePrice(offers: readonly Offer[]): Offer[] {
  return offers
    .filter((offer) => offer.comparable)
    .sort((left, right) => {
      const leftPrice = left.totalPriceCny?.amountMinor ?? left.totalPrice.amountMinor;
      const rightPrice = right.totalPriceCny?.amountMinor ?? right.totalPrice.amountMinor;
      return leftPrice - rightPrice || right.qualityScore - left.qualityScore;
    });
}

function journeyMinutes(offer: Offer): number {
  return offer.segments.reduce((sum, segment) => sum + segment.durationMinutes, 0);
}

export function rankRecommended(offers: readonly Offer[]): Offer[] {
  const comparable = rankByLowestComparablePrice(offers);
  if (comparable.length === 0) return [];
  const cheapest = comparable[0]?.totalPriceCny?.amountMinor ?? comparable[0]?.totalPrice.amountMinor ?? 1;
  return [...comparable].sort((left, right) => {
    const score = (offer: Offer) => {
      const price = offer.totalPriceCny?.amountMinor ?? offer.totalPrice.amountMinor;
      const pricePenalty = ((price - cheapest) / cheapest) * 45;
      const stopPenalty = Math.max(0, offer.segments.length - 1) * 8;
      const durationPenalty = journeyMinutes(offer) / 120;
      const eligibilityPenalty = offer.eligibility.length * 5;
      return offer.qualityScore - pricePenalty - stopPenalty - durationPenalty - eligibilityPenalty;
    };
    return score(right) - score(left);
  });
}

export type AdversarialFinding = {
  code: string;
  severity: "info" | "warning" | "blocking";
  message: string;
  offerId?: string;
};

export function reviewOffers(
  offers: readonly Offer[],
  reports: readonly ConnectorReport[],
): AdversarialFinding[] {
  const findings: AdversarialFinding[] = [];
  for (const offer of offers) {
    for (const issue of validatePriceArithmetic(offer)) {
      findings.push({
        code: issue,
        severity: "blocking",
        message: "报价构成与最终总价不一致，不能参与最低全价比较。",
        offerId: offer.id,
      });
    }
    if (offer.environment === "demo") {
      findings.push({
        code: "DEMO_OFFER",
        severity: "blocking",
        message: "演示报价不能进入实时最低价结论。",
        offerId: offer.id,
      });
    }
    if (offer.eligibility.length > 0) {
      findings.push({
        code: "CONDITIONAL_PRICE",
        severity: "warning",
        message: "该报价带有购买资格条件，不能与无门槛公开价静默混排。",
        offerId: offer.id,
      });
    }
  }

  const timedOut = reports.filter((report) => report.state === "timeout");
  if (timedOut.length > 0) {
    findings.push({
      code: "INCOMPLETE_COVERAGE",
      severity: "warning",
      message: `${timedOut.length} 个来源超时，最低价结论仅适用于成功核验的来源。`,
    });
  }
  return findings;
}

export function disclosureStatement(reports: readonly ConnectorReport[]): string {
  const success = reports.filter((report) => ["success", "empty"].includes(report.state)).length;
  const timeout = reports.filter((report) => report.state === "timeout").length;
  const failed = reports.length - success - timeout;
  return `本次计划检索 ${reports.length} 个来源，成功核验 ${success} 个，${timeout} 个超时，${failed} 个失败。最低价仅代表成功返回且价格口径可比的来源。`;
}
