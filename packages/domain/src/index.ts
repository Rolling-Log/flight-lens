import type { ConnectorReport, Offer, SearchIntent } from "@flight-lens/contracts";

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
  if (
    offer.priceComponents.some(
      (component) => component.currency !== offer.totalPrice.currency,
    )
  ) {
    issues.push("MIXED_COMPONENT_CURRENCY");
  }
  return issues;
}

export function validateCurrencyConversion(offer: Offer): string[] {
  const issues: string[] = [];
  if (offer.totalPrice.currency === "CNY") {
    if (
      offer.totalPriceCny &&
      (offer.totalPriceCny.currency !== "CNY" ||
        offer.totalPriceCny.amountMinor !== offer.totalPrice.amountMinor)
    ) {
      issues.push("CNY_TOTAL_MISMATCH");
    }
    return issues;
  }

  if (!offer.totalPriceCny || offer.totalPriceCny.currency !== "CNY") {
    issues.push("CNY_CONVERSION_MISSING");
  }
  if (!offer.exchangeRate) {
    issues.push("EXCHANGE_RATE_EVIDENCE_MISSING");
  } else if (
    offer.exchangeRate.baseCurrency !== offer.totalPrice.currency ||
    offer.exchangeRate.quoteCurrency !== "CNY"
  ) {
    issues.push("EXCHANGE_RATE_CURRENCY_MISMATCH");
  }
  return issues;
}

export function validateItineraryStructure(offer: Offer): string[] {
  const issues: string[] = [];
  const segmentById = new Map(offer.segments.map((segment) => [segment.id, segment]));
  const referenced = new Set<string>();
  for (const [legIndex, leg] of offer.legs.entries()) {
    const legSegments = leg.segmentIds.map((id) => segmentById.get(id));
    if (
      legSegments.some((segment) => !segment) ||
      legSegments.some((segment) => segment?.legIndex !== legIndex)
    ) {
      issues.push("LEG_SEGMENT_REFERENCE_MISMATCH");
      continue;
    }
    for (const id of leg.segmentIds) {
      if (referenced.has(id)) issues.push("DUPLICATE_LEG_SEGMENT_REFERENCE");
      referenced.add(id);
    }
    const first = legSegments[0]!;
    const last = legSegments.at(-1)!;
    const airborneMinutes = legSegments.reduce(
      (total, segment) => total + segment!.durationMinutes,
      0,
    );
    if (
      leg.origin.code !== first.origin.code ||
      leg.destination.code !== last.destination.code ||
      leg.departureAt !== first.departureAt ||
      leg.arrivalAt !== last.arrivalAt ||
      leg.stopCount !== leg.segmentIds.length - 1 ||
      leg.durationMinutes < airborneMinutes
    ) {
      issues.push("LEG_SUMMARY_MISMATCH");
    }
  }
  if (referenced.size !== offer.segments.length) issues.push("UNREFERENCED_SEGMENT");
  return [...new Set(issues)];
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
    const sellerIdentity = `${offer.seller.kind}:${offer.seller.name
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .replace(/[\s\p{P}\p{S}]+/gu, "")}`;
    const key = `${offerFingerprint(offer)}::${sellerIdentity}`;
    const current = byFingerprintAndSeller.get(key);
    const offerPrice = offer.totalPriceCny?.amountMinor ?? offer.totalPrice.amountMinor;
    const currentPrice =
      current?.totalPriceCny?.amountMinor ?? current?.totalPrice.amountMinor ?? Number.MAX_SAFE_INTEGER;
    if (
      !current ||
      offerPrice < currentPrice ||
      (offerPrice === currentPrice && Number(offer.comparable) > Number(current.comparable)) ||
      (offerPrice === currentPrice &&
        offer.comparable === current.comparable &&
        offer.qualityScore > current.qualityScore)
    ) {
      byFingerprintAndSeller.set(key, offer);
    }
  }
  return [...byFingerprintAndSeller.values()];
}

function firstDepartureTime(offer: Offer): string | undefined {
  return offer.legs[0]?.departureAt.slice(11, 16);
}

function hasRequiredCheckedBaggage(offer: Offer, minimumKg: number): boolean {
  if (minimumKg === 0) return true;
  return offer.baggage.some(
    (allowance) =>
      allowance.type === "checked" &&
      allowance.included &&
      typeof allowance.weightKg === "number" &&
      allowance.weightKg >= minimumKg,
  );
}

function isRedEye(value: string | undefined): boolean {
  if (!value) return false;
  const hour = Number(value.slice(0, 2));
  return Number.isInteger(hour) && hour >= 0 && hour < 6;
}

export function applyIntentConstraints(
  offers: readonly Offer[],
  intent: SearchIntent,
): Offer[] {
  return offers.map((offer) => {
    const departureTime = firstDepartureTime(offer);
    const priceCny = offer.totalPriceCny?.amountMinor ??
      (offer.totalPrice.currency === "CNY" ? offer.totalPrice.amountMinor : undefined);
    const reasons = [
      ...offer.incomparabilityReasons,
      ...(intent.budget && intent.budget.currency === "CNY" &&
      (priceCny === undefined || priceCny > intent.budget.amountMinor)
        ? [priceCny === undefined ? "BUDGET_CURRENCY_UNVERIFIED" : "OVER_BUDGET"]
        : []),
      ...(intent.departureTime?.earliest &&
      (!departureTime || departureTime < intent.departureTime.earliest)
        ? ["DEPARTURE_BEFORE_TIME_WINDOW"]
        : []),
      ...(intent.departureTime?.latest &&
      (!departureTime || departureTime > intent.departureTime.latest)
        ? ["DEPARTURE_AFTER_TIME_WINDOW"]
        : []),
      ...(offer.legs.some((leg) => leg.stopCount > (intent.directOnly ? 0 : intent.maxStops))
        ? ["STOP_LIMIT_CONFLICT"]
        : []),
      ...(intent.avoidRedEye && isRedEye(departureTime) ? ["RED_EYE_CONFLICT"] : []),
      ...(hasRequiredCheckedBaggage(offer, intent.minimumCheckedBaggageKg)
        ? []
        : ["CHECKED_BAGGAGE_REQUIREMENT_UNVERIFIED"]),
    ];
    const uniqueReasons = [...new Set(reasons)];
    return {
      ...offer,
      comparable: offer.comparable && uniqueReasons.length === 0,
      incomparabilityReasons: uniqueReasons,
    };
  });
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
  return offer.legs.reduce((sum, leg) => sum + leg.durationMinutes, 0);
}

function totalStops(offer: Offer): number {
  return offer.legs.reduce((sum, leg) => sum + leg.stopCount, 0);
}

function checkedBaggageKg(offer: Offer): number {
  return Math.max(
    0,
    ...offer.baggage
      .filter((allowance) => allowance.type === "checked" && allowance.included)
      .map((allowance) => allowance.weightKg ?? 0),
  );
}

function comparablePriceMinor(offer: Offer): number {
  return offer.totalPriceCny?.amountMinor ?? offer.totalPrice.amountMinor;
}

function comparableOffers(offers: readonly Offer[]): Offer[] {
  return offers.filter((offer) => offer.comparable);
}

export function rankByShortestDuration(offers: readonly Offer[]): Offer[] {
  return comparableOffers(offers).sort(
    (left, right) =>
      journeyMinutes(left) - journeyMinutes(right) ||
      totalStops(left) - totalStops(right),
  );
}

export function rankByFewestStops(offers: readonly Offer[]): Offer[] {
  return comparableOffers(offers).sort(
    (left, right) =>
      totalStops(left) - totalStops(right) ||
      journeyMinutes(left) - journeyMinutes(right),
  );
}

export function rankByBestBaggage(offers: readonly Offer[]): Offer[] {
  return comparableOffers(offers).filter((offer) => checkedBaggageKg(offer) > 0).sort(
    (left, right) =>
      checkedBaggageKg(right) - checkedBaggageKg(left) ||
      comparablePriceMinor(left) - comparablePriceMinor(right),
  );
}

export function rankByRefundFlexibility(offers: readonly Offer[]): Offer[] {
  const flexibility = (offer: Offer) =>
    Number(offer.refundable === true) * 2 + Number(offer.changeable === true);
  return comparableOffers(offers).filter((offer) => flexibility(offer) > 0).sort(
    (left, right) =>
      flexibility(right) - flexibility(left) ||
      comparablePriceMinor(left) - comparablePriceMinor(right),
  );
}

export function rankRecommended(offers: readonly Offer[]): Offer[] {
  const comparable = rankByLowestComparablePrice(offers);
  if (comparable.length === 0) return [];
  const cheapest = comparable[0]?.totalPriceCny?.amountMinor ?? comparable[0]?.totalPrice.amountMinor ?? 1;
  return [...comparable].sort((left, right) => {
    const score = (offer: Offer) => {
      const price = offer.totalPriceCny?.amountMinor ?? offer.totalPrice.amountMinor;
      const pricePenalty = ((price - cheapest) / cheapest) * 45;
      const stopPenalty = totalStops(offer) * 8;
      const durationPenalty = journeyMinutes(offer) / 120;
      const exactHandoffBonus = offer.seller.handoffPrecision === "exact_offer" ? 6 : 0;
      const baggageEvidenceBonus = checkedBaggageKg(offer) > 0 ? 2 : 0;
      const rulesEvidenceBonus =
        Number(offer.refundable !== null) + Number(offer.changeable !== null);
      return 100 - pricePenalty - stopPenalty - durationPenalty + exactHandoffBonus +
        baggageEvidenceBonus + rulesEvidenceBonus;
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
    for (const issue of [
      ...validatePriceArithmetic(offer),
      ...validateCurrencyConversion(offer),
      ...validateItineraryStructure(offer),
    ]) {
      findings.push({
        code: issue,
        severity: "blocking",
        message:
          issue === "TOTAL_PRICE_MISMATCH" || issue === "MIXED_COMPONENT_CURRENCY"
            ? "报价构成与最终总价不一致，不能参与最低全价比较。"
            : issue.includes("CNY") || issue.includes("EXCHANGE_RATE")
              ? "外币报价缺少可验证的人民币换算来源或时间，不能参与最低全价比较。"
            : "行程的去返程、航段或总耗时结构不一致，不能参与推荐。",
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
    if (offer.comparable && !offer.seller.deepLink) {
      findings.push({
        code: "NO_PURCHASE_HANDOFF",
        severity: "blocking",
        message: "该报价没有可验证的航司或 OTA 购买落点，不能称为可购买最低价。",
        offerId: offer.id,
      });
    }
    if (offer.seller.handoffPrecision === "search_results") {
      findings.push({
        code: "HANDOFF_REQUIRES_RESELECTION",
        severity: "warning",
        message: "该报价只能跳转到带搜索条件的来源结果页，用户需要重新选择并核验最终价格。",
        offerId: offer.id,
      });
    }
    if (offer.eligibility.length > 0) {
      findings.push({
        code: "CONDITIONAL_PRICE",
        severity: "blocking",
        message: "该报价带有购买资格条件，不能进入无门槛公开最低价或自然推荐。",
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

export function applyAdversarialComparability(
  offers: readonly Offer[],
  reports: readonly ConnectorReport[],
): Offer[] {
  const blockingCodesByOffer = new Map<string, string[]>();
  for (const finding of reviewOffers(offers, reports)) {
    if (finding.severity !== "blocking" || !finding.offerId) continue;
    const codes = blockingCodesByOffer.get(finding.offerId) ?? [];
    codes.push(finding.code);
    blockingCodesByOffer.set(finding.offerId, codes);
  }
  return offers.map((offer) => {
    const blockingCodes = blockingCodesByOffer.get(offer.id) ?? [];
    return blockingCodes.length === 0
      ? offer
      : {
          ...offer,
          comparable: false,
          incomparabilityReasons: [
            ...new Set([...offer.incomparabilityReasons, ...blockingCodes]),
          ],
        };
  });
}

export function disclosureStatement(reports: readonly ConnectorReport[]): string {
  const success = reports.filter((report) => ["success", "empty"].includes(report.state)).length;
  const timeout = reports.filter((report) => report.state === "timeout").length;
  const failed = reports.length - success - timeout;
  const partial = reports.filter(
    (report) => report.errorCode === "PARTIAL_DATE_PROBE_FAILURE",
  ).length;
  const cached = reports.filter((report) =>
    report.notes.some((note) => note.startsWith("CACHE_")),
  ).length;
  return `本次计划检索 ${reports.length} 个来源，成功核验 ${success} 个，${timeout} 个超时，${failed} 个失败${partial ? `，其中 ${partial} 个来源仅完成部分日期探测` : ""}${cached ? `，${cached} 个来源使用了已明确标记的缓存结果` : ""}。最低价仅代表成功返回且价格口径可比的来源。`;
}
