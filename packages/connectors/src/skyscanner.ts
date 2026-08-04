import type { Offer, SearchIntent } from "@flight-lens/contracts";
import { ConnectorError, providerHttpError } from "./errors.js";
import type {
  ConnectorHealth,
  ConnectorMetadata,
  ConnectorSearchContext,
  ConnectorSearchResult,
  FlightConnector,
} from "./index.js";

type SkyscannerConfig = {
  apiKey: string;
  baseUrl: string;
};

type SkyscannerPrice = {
  amount?: string;
  unit?: string;
};

type SkyscannerDateTime = {
  year?: number;
  month?: number;
  day?: number;
  hour?: number;
  minute?: number;
  second?: number;
};

type SkyscannerPricingItem = {
  price?: SkyscannerPrice;
  agentId?: string;
  deepLink?: string;
};

type SkyscannerBaggage = {
  assessment?: string;
  pieces?: number;
  weight?: string;
  fee?: SkyscannerPrice;
};

type SkyscannerPricingOption = {
  id?: string;
  price?: SkyscannerPrice;
  agentIds?: string[];
  items?: SkyscannerPricingItem[];
  transferType?: string;
  pricingOptionFare?: {
    checkedBaggage?: SkyscannerBaggage;
    advanceChange?: { assessment?: string };
    cancellation?: { assessment?: string };
    brandNames?: string[];
  };
};

type SkyscannerItinerary = {
  pricingOptions?: SkyscannerPricingOption[];
  legIds?: string[];
};

type SkyscannerLeg = {
  originPlaceId?: string;
  destinationPlaceId?: string;
  departureDateTime?: SkyscannerDateTime;
  arrivalDateTime?: SkyscannerDateTime;
  durationInMinutes?: number;
  stopCount?: number;
  segmentIds?: string[];
};

type SkyscannerSegment = {
  originPlaceId?: string;
  destinationPlaceId?: string;
  departureDateTime?: SkyscannerDateTime;
  arrivalDateTime?: SkyscannerDateTime;
  durationInMinutes?: number;
  marketingFlightNumber?: string;
  marketingCarrierId?: string;
  operatingCarrierId?: string;
};

type SkyscannerPlace = {
  name?: string;
  iata?: string;
};

type SkyscannerCarrier = {
  name?: string;
  iata?: string;
  displayCode?: string;
};

type SkyscannerAgent = {
  name?: string;
  type?: string;
};

export type SkyscannerSearchResults = {
  itineraries?: Record<string, SkyscannerItinerary>;
  legs?: Record<string, SkyscannerLeg>;
  segments?: Record<string, SkyscannerSegment>;
  places?: Record<string, SkyscannerPlace>;
  carriers?: Record<string, SkyscannerCarrier>;
  agents?: Record<string, SkyscannerAgent>;
};

export type SkyscannerSearchPayload = {
  sessionToken?: string;
  status?: string;
  action?: string;
  content?: {
    results?: SkyscannerSearchResults;
  };
};

type ParsedMinorAmount = {
  amountMinor: number;
  exact: boolean;
};

const PRICE_UNIT_RELATION: Record<string, bigint> = {
  PRICE_UNIT_WHOLE: 1n,
  PRICE_UNIT_CENTI: 100n,
  PRICE_UNIT_MILLI: 1_000n,
  PRICE_UNIT_MICRO: 1_000_000n,
};

function priceMinor(price: SkyscannerPrice | undefined): ParsedMinorAmount | undefined {
  if (
    !price ||
    typeof price.amount !== "string" ||
    !/^\d+(?:\.\d+)?$/.test(price.amount) ||
    typeof price.unit !== "string"
  ) {
    return undefined;
  }
  const relation = PRICE_UNIT_RELATION[price.unit];
  if (!relation) return undefined;

  const [whole = "0", fraction = ""] = price.amount.split(".");
  const decimalScale = 10n ** BigInt(fraction.length);
  const numerator = BigInt(`${whole}${fraction}`) * 100n;
  const denominator = relation * decimalScale;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded = quotient + (remainder * 2n >= denominator ? 1n : 0n);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return {
    amountMinor: Number(rounded),
    exact: remainder === 0n,
  };
}

function localDateTime(value: SkyscannerDateTime | undefined): string | undefined {
  if (
    !value ||
    !Number.isInteger(value.year) ||
    !Number.isInteger(value.month) ||
    !Number.isInteger(value.day) ||
    !Number.isInteger(value.hour) ||
    !Number.isInteger(value.minute)
  ) {
    return undefined;
  }
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.year}-${pad(value.month!)}-${pad(value.day!)}T${pad(value.hour!)}:${pad(
    value.minute!,
  )}:${pad(value.second ?? 0)}`;
}

function safeDeepLink(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

function normalizedCarrierCode(carrier: SkyscannerCarrier | undefined): string | undefined {
  const value = carrier?.displayCode ?? carrier?.iata;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9]{2,3}$/.test(normalized) ? normalized : undefined;
}

function normalizedFlightNumber(value: unknown, carrierCode: string): string | undefined {
  if (typeof value !== "string") return undefined;
  const compact = value.replace(/\s+/g, "").toUpperCase();
  const withoutCarrier = compact.startsWith(carrierCode)
    ? compact.slice(carrierCode.length)
    : compact;
  return /^[A-Z0-9]+$/.test(withoutCarrier) ? withoutCarrier : undefined;
}

function timeInsideWindow(value: string, intent: SearchIntent): boolean {
  if (!intent.departureTime) return true;
  const localTime = value.slice(11, 16);
  if (intent.departureTime.earliest && localTime < intent.departureTime.earliest) return false;
  if (intent.departureTime.latest && localTime > intent.departureTime.latest) return false;
  return true;
}

function isRedEyeDeparture(value: string): boolean {
  const hour = Number(value.slice(11, 13));
  return Number.isInteger(hour) && hour >= 0 && hour < 6;
}

function includedCheckedBaggage(
  value: SkyscannerBaggage | undefined,
): Offer["baggage"][number] | undefined {
  if (!value?.assessment?.includes("INCLUDED")) return undefined;
  const weight = typeof value.weight === "string"
    ? Number(/^(\d+(?:\.\d+)?)/.exec(value.weight)?.[1])
    : undefined;
  return {
    type: "checked",
    included: true,
    ...(Number.isInteger(value.pieces) && value.pieces! >= 0 ? { quantity: value.pieces } : {}),
    ...(Number.isFinite(weight) && weight! >= 0 ? { weightKg: weight } : {}),
  };
}

function assessmentBoolean(value: string | undefined): boolean | null {
  if (!value || value.includes("UNKNOWN") || value.includes("UNSPECIFIED")) return null;
  if (value.includes("NOT_AVAILABLE") || value.includes("UNAVAILABLE")) return false;
  if (value.includes("INCLUDED") || value.includes("AVAILABLE")) return true;
  return null;
}

type ResolvedItinerary = {
  legs: Offer["legs"];
  segments: Offer["segments"];
  maximumStops: number;
  firstDepartureAt: string;
  redEyeDeparture: boolean;
};

function resolveItinerary(
  itinerary: SkyscannerItinerary,
  results: SkyscannerSearchResults,
  requestId: string,
): ResolvedItinerary | undefined {
  const legIds = itinerary.legIds ?? [];
  if (legIds.length === 0) return undefined;
  const output: Offer["segments"] = [];
  const outputLegs: Offer["legs"] = [];
  let maximumStops = 0;
  let firstDepartureAt: string | undefined;
  let redEyeDeparture = false;

  for (const [legIndex, legId] of legIds.entries()) {
    const leg = results.legs?.[legId];
    if (!leg) return undefined;
    const segmentIds = leg.segmentIds ?? [];
    if (segmentIds.length === 0) return undefined;
    const stopCount = segmentIds.length - 1;
    maximumStops = Math.max(maximumStops, stopCount);
    const legSegmentIds: string[] = [];

    for (const [index, segmentId] of segmentIds.entries()) {
      const segment = results.segments?.[segmentId];
      const origin = segment?.originPlaceId
        ? results.places?.[segment.originPlaceId]
        : undefined;
      const destination = segment?.destinationPlaceId
        ? results.places?.[segment.destinationPlaceId]
        : undefined;
      const marketingCarrier = segment?.marketingCarrierId
        ? results.carriers?.[segment.marketingCarrierId]
        : undefined;
      const operatingCarrier = segment?.operatingCarrierId
        ? results.carriers?.[segment.operatingCarrierId]
        : undefined;
      const marketingCode = normalizedCarrierCode(marketingCarrier);
      const operatingCode = normalizedCarrierCode(operatingCarrier);
      const flightNumber = marketingCode
        ? normalizedFlightNumber(segment?.marketingFlightNumber, marketingCode)
        : undefined;
      const departureAt = localDateTime(segment?.departureDateTime);
      const arrivalAt = localDateTime(segment?.arrivalDateTime);
      const segmentDuration = segment?.durationInMinutes;
      if (
        !segment ||
        !origin?.iata ||
        !destination?.iata ||
        !marketingCode ||
        !flightNumber ||
        !departureAt ||
        !arrivalAt ||
        !Number.isInteger(segmentDuration) ||
        segmentDuration! <= 0
      ) {
        return undefined;
      }
      if (index === 0) {
        firstDepartureAt ??= departureAt;
        redEyeDeparture ||= isRedEyeDeparture(departureAt);
      }
      const normalizedSegmentId = `skyscanner:${requestId}:${segmentId}`;
      legSegmentIds.push(normalizedSegmentId);
      output.push({
        id: normalizedSegmentId,
        legIndex,
        marketingCarrier: marketingCode,
        ...(operatingCode ? { operatingCarrier: operatingCode } : {}),
        flightNumber,
        origin: {
          kind: "airport",
          code: origin.iata,
          ...(origin.name ? { name: origin.name } : {}),
        },
        destination: {
          kind: "airport",
          code: destination.iata,
          ...(destination.name ? { name: destination.name } : {}),
        },
        departureAt,
        arrivalAt,
        durationMinutes: segmentDuration!,
      });
    }
    const legSegments = output.filter((segment) => segment.legIndex === legIndex);
    const firstLegSegment = legSegments[0];
    const lastLegSegment = legSegments.at(-1);
    const airborneMinutes = legSegments.reduce(
      (total, segment) => total + segment.durationMinutes,
      0,
    );
    if (!firstLegSegment || !lastLegSegment) return undefined;
    outputLegs.push({
      id: `skyscanner:${requestId}:${legId}`,
      segmentIds: legSegmentIds,
      origin: firstLegSegment.origin,
      destination: lastLegSegment.destination,
      departureAt: firstLegSegment.departureAt,
      arrivalAt: lastLegSegment.arrivalAt,
      durationMinutes:
        Number.isInteger(leg.durationInMinutes) &&
        leg.durationInMinutes! >= airborneMinutes
          ? leg.durationInMinutes!
          : airborneMinutes,
      stopCount,
    });
  }
  return firstDepartureAt
    ? {
        legs: outputLegs,
        segments: output,
        maximumStops,
        firstDepartureAt,
        redEyeDeparture,
      }
    : undefined;
}

export function mapSkyscannerSearchResults(
  results: SkyscannerSearchResults,
  intent: SearchIntent,
  requestId: string,
): Offer[] {
  const offers: Offer[] = [];
  for (const [itineraryId, itinerary] of Object.entries(results.itineraries ?? {})) {
    const resolved = resolveItinerary(itinerary, results, requestId);
    if (!resolved) continue;

    for (const [optionIndex, option] of (itinerary.pricingOptions ?? []).entries()) {
      const total = priceMinor(option.price);
      const items = option.items ?? [];
      if (!total || items.length === 0) continue;
      const soleItem = items.length === 1 ? items[0] : undefined;
      const agent = soleItem?.agentId ? results.agents?.[soleItem.agentId] : undefined;
      const deepLink = safeDeepLink(soleItem?.deepLink);
      const baggage = includedCheckedBaggage(option.pricingOptionFare?.checkedBaggage);
      const baggageMeetsRequirement =
        intent.minimumCheckedBaggageKg === 0 ||
        (baggage?.weightKg !== undefined &&
          baggage.weightKg >= intent.minimumCheckedBaggageKg);
      const transferType = option.transferType ?? "TRANSFER_TYPE_UNSPECIFIED";
      const selfTransfer =
        transferType === "TRANSFER_TYPE_SELF_TRANSFER" ||
        transferType === "TRANSFER_TYPE_PROTECTED_SELF_TRANSFER";
      const tooManyStops =
        intent.directOnly
          ? resolved.maximumStops > 0
          : resolved.maximumStops > intent.maxStops;
      const reasons = [
        ...(deepLink ? [] : ["NO_PURCHASE_HANDOFF"]),
        ...(items.length === 1 ? [] : ["MULTIPLE_PURCHASE_HANDOFFS"]),
        ...(total.exact ? [] : ["SUB_CENT_PRICE_ROUNDED"]),
        ...(baggageMeetsRequirement ? [] : ["CHECKED_BAGGAGE_UNVERIFIED"]),
        ...(timeInsideWindow(resolved.firstDepartureAt, intent)
          ? []
          : ["DEPARTURE_TIME_CONFLICT"]),
        ...(intent.avoidRedEye && resolved.redEyeDeparture ? ["RED_EYE_CONFLICT"] : []),
        ...(tooManyStops ? ["MAX_STOPS_CONFLICT"] : []),
        ...(selfTransfer ? ["SELF_TRANSFER"] : []),
        ...(intent.flexibleDays === 0 ? [] : ["FLEXIBLE_DATE_RANGE_NOT_EXPANDED"]),
      ];
      const sourceOfferId = option.id ?? `${itineraryId}:${optionIndex}`;
      const sellerName =
        agent?.name ??
        (items.length > 1
          ? items
              .map((item) => item.agentId && results.agents?.[item.agentId]?.name)
              .filter((name): name is string => Boolean(name))
              .join(" + ") || "多个售卖方"
          : "Skyscanner 售卖方");
      const sellerKind = agent?.type === "AGENT_TYPE_AIRLINE" ? "airline" : "ota";
      const fareBrand = option.pricingOptionFare?.brandNames?.filter(Boolean).join(" / ");

      offers.push({
        schemaVersion: "1",
        id: `skyscanner:${requestId}:${itineraryId}:${sourceOfferId}`,
        sourceOfferId,
        connectorId: "skyscanner-live-prices",
        environment: "production",
        seller: {
          id: soleItem?.agentId ?? `skyscanner-multi:${sourceOfferId}`,
          name: sellerName,
          kind: items.length === 1 ? sellerKind : "aggregator",
          ...(deepLink ? { deepLink } : {}),
        },
        legs: resolved.legs,
        segments: resolved.segments,
        priceComponents: [{
          kind: "required_service",
          label: "Skyscanner Live Prices 展示总价（供应方未拆分）",
          amountMinor: total.amountMinor,
          currency: "CNY",
          required: true,
        }],
        totalPrice: { amountMinor: total.amountMinor, currency: "CNY" },
        totalPriceCny: { amountMinor: total.amountMinor, currency: "CNY" },
        baggage: baggage ? [baggage] : [],
        ...(fareBrand ? { fareBrand } : {}),
        refundable: assessmentBoolean(option.pricingOptionFare?.cancellation?.assessment),
        changeable: assessmentBoolean(option.pricingOptionFare?.advanceChange?.assessment),
        eligibility: [
          ...(items.length > 1 ? ["MULTIPLE_TICKETS"] : []),
          ...(selfTransfer ? ["SELF_TRANSFER"] : []),
        ],
        fetchedAt: new Date().toISOString(),
        evidenceRef: `skyscanner:${itineraryId}:${sourceOfferId}`,
        comparable: reasons.length === 0,
        incomparabilityReasons: reasons,
        qualityScore: reasons.length === 0 ? 90 : 58,
      });
    }
  }
  return offers;
}

function queryDate(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split("-").map(Number);
  return { year: year!, month: month!, day: day! };
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
  });
}

export class SkyscannerConnector implements FlightConnector {
  readonly metadata: ConnectorMetadata = {
    id: "skyscanner-live-prices",
    name: "Skyscanner Flights Live Prices",
    kind: "metasearch",
    environment: "production",
    authorization: "partner_api",
    resultRole: "purchase_handoff",
    handoff: "deep_link",
    configured: true,
  };

  constructor(private readonly config: SkyscannerConfig) {}

  async health(signal: AbortSignal): Promise<ConnectorHealth> {
    try {
      const response = await fetch(
        new URL("/apiservices/v3/culture/markets/zh-CN", this.config.baseUrl),
        {
          headers: { "x-api-key": this.config.apiKey, accept: "application/json" },
          signal,
        },
      );
      return {
        state: response.ok ? "healthy" : "degraded",
        checkedAt: new Date().toISOString(),
        ...(response.ok ? {} : { detail: `HTTP ${response.status}` }),
      };
    } catch (error) {
      return {
        state: "unavailable",
        checkedAt: new Date().toISOString(),
        detail: error instanceof Error ? error.message : "Unknown provider error",
      };
    }
  }

  async search(
    intent: SearchIntent,
    context: ConnectorSearchContext,
  ): Promise<ConnectorSearchResult> {
    const queryLegs = [{
      originPlaceId: { iata: intent.origin.code },
      destinationPlaceId: { iata: intent.destination.code },
      date: queryDate(intent.departureDate),
    }];
    if (intent.returnDate) {
      queryLegs.push({
        originPlaceId: { iata: intent.destination.code },
        destinationPlaceId: { iata: intent.origin.code },
        date: queryDate(intent.returnDate),
      });
    }

    let payload = await this.request(
      "/apiservices/v3/flights/live/search/create",
      {
        query: {
          market: "CN",
          locale: "zh-CN",
          currency: "CNY",
          queryLegs,
          adults: intent.adults,
          cabinClass: "CABIN_CLASS_ECONOMY",
          nearbyAirports: intent.includeNearbyAirports,
          includeSustainabilityData: false,
        },
      },
      context.signal,
    );
    const sessionToken = payload.sessionToken;
    let results = payload.content?.results;

    for (let pollCount = 0; payload.status !== "RESULT_STATUS_COMPLETE"; pollCount += 1) {
      if (payload.status === "RESULT_STATUS_FAILED") {
        throw new ConnectorError(
          "Skyscanner reported a failed live-pricing session.",
          "SKYSCANNER_SESSION_FAILED",
          "provider_error",
          true,
        );
      }
      if (!sessionToken) {
        throw new ConnectorError(
          "Skyscanner did not return a session token.",
          "SKYSCANNER_INVALID_SESSION",
          "invalid_response",
          false,
        );
      }
      if (pollCount >= 20) {
        throw new ConnectorError(
          "Skyscanner did not complete the live-pricing session in time.",
          "SKYSCANNER_INCOMPLETE_SESSION",
          "timeout",
          true,
        );
      }
      await delay(400, context.signal);
      payload = await this.request(
        `/apiservices/v3/flights/live/search/poll/${encodeURIComponent(sessionToken)}`,
        undefined,
        context.signal,
      );
      if (payload.action === "RESULT_ACTION_REPLACED" && payload.content?.results) {
        results = payload.content.results;
      }
    }

    if (!results) {
      throw new ConnectorError(
        "Skyscanner completed without a results object.",
        "SKYSCANNER_INVALID_RESULTS",
        "invalid_response",
        false,
      );
    }
    return {
      offers: mapSkyscannerSearchResults(results, intent, context.requestId),
      providerRequestId: context.requestId,
      ...(intent.includeNearbyAirports
        ? { notes: [`NEARBY_ORIGIN_PROVIDER_EXPANSION:${intent.origin.code}`] }
        : {}),
    };
  }

  private async request(
    path: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<SkyscannerSearchPayload> {
    const response = await fetch(new URL(path, this.config.baseUrl), {
      method: "POST",
      headers: {
        "x-api-key": this.config.apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    });
    if (!response.ok) throw await providerHttpError("SKYSCANNER", response);
    const payload = await response.json() as SkyscannerSearchPayload;
    if (!payload || typeof payload !== "object") {
      throw new ConnectorError(
        "Skyscanner returned an invalid JSON response.",
        "SKYSCANNER_INVALID_RESPONSE",
        "invalid_response",
        false,
      );
    }
    return payload;
  }
}
