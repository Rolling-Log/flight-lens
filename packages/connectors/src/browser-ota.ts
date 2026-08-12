import { access } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";
import {
  locationOptions,
  CompanionJourneyResult,
  CompanionPlatformResult,
  Offer,
  SearchIntent,
} from "@flight-lens/contracts";
import { ConnectorError } from "./errors.js";
import type {
  ConnectorHealth,
  ConnectorMetadata,
  ConnectorSearchContext,
  ConnectorSearchResult,
  FlightConnector,
} from "./index.js";

export type BrowserOtaPlatform = "ctrip" | "qunar" | "tongcheng" | "fliggy";

export type BrowserOtaConfig = {
  platform: BrowserOtaPlatform;
  executablePath?: string;
  headless?: boolean;
  proxyServer?: string;
  navigationTimeoutMs?: number;
};

type PlatformDefinition = {
  metadata: ConnectorMetadata;
  buildUrl(intent: SearchIntent): string;
  responsePatterns: RegExp[];
  selectors: {
    resultContainer: string[];
    flightCard: string[];
    flightNumber: string[];
    airlineName: string[];
    departureTime: string[];
    arrivalTime: string[];
    departureAirport: string[];
    arrivalAirport: string[];
    price: string[];
  };
};

export type RawDomCard = {
  cardText: string;
  flightNumberText: string;
  airlineName: string;
  departureTime: string;
  arrivalTime: string;
  departureAirport: string;
  arrivalAirport: string;
  priceText: string;
  evidenceKind?: "structured_response" | "dom" | undefined;
};

type JsonObject = Record<string, unknown>;

const CITY_NAMES: Record<string, string> = {
  PEK: "北京",
  PKX: "北京",
  SHA: "上海",
  PVG: "上海",
  CAN: "广州",
  SZX: "深圳",
  CTU: "成都",
  TFU: "成都",
  CKG: "重庆",
  HGH: "杭州",
  NKG: "南京",
  WUH: "武汉",
  XIY: "西安",
  TAO: "青岛",
  XMN: "厦门",
  KMG: "昆明",
  CSX: "长沙",
  NRT: "东京",
  HND: "东京",
  KIX: "大阪",
  SIN: "新加坡",
};

function cityName(airport: SearchIntent["origin"]): string {
  return airport.name ?? CITY_NAMES[airport.code] ?? airport.code;
}

const DEFINITIONS: Record<BrowserOtaPlatform, PlatformDefinition> = {
  ctrip: {
    metadata: {
      id: "ctrip-browser",
      name: "携程实时页面",
      kind: "ota",
      environment: "production",
      authorization: "browser_session",
      resultRole: "purchase_handoff",
      handoff: "deep_link",
      inventoryFamily: "ctrip",
      configured: true,
      supportsFlexibleDateProbe: false,
      capabilities: {
        tripTypes: ["one_way", "round_trip"],
        markets: ["domestic_cn", "international"],
        locationKinds: ["airport"],
        cabins: ["economy", "premium_economy", "business", "first"],
        maxAdults: 9,
        roundTripMode: "native",
        priceEvidence: ["listed", "provider_response"],
        dataAccess: ["structured_response", "dom"],
        credentialRequirement: "browser_session",
        humanInteraction: "login_or_verification_possible",
        executionLocation: "server",
      },
    },
    buildUrl(intent) {
      const origin = intent.origin.code.toLowerCase();
      const destination = intent.destination.code.toLowerCase();
      const cabin = {
        economy: "y",
        premium_economy: "s",
        business: "c",
        first: "f",
      }[intent.cabin];
      if (intent.tripType === "round_trip" && intent.returnDate) {
        return `https://flights.ctrip.com/online/list/round-${origin}-${destination}?depdate=${intent.departureDate}_${intent.returnDate}&cabin=${cabin}&adult=${intent.adults}&child=0&infant=0`;
      }
      return `https://flights.ctrip.com/online/list/oneway-${origin}-${destination}?depdate=${intent.departureDate}&cabin=${cabin}&adult=${intent.adults}&child=0&infant=0`;
    },
    responsePatterns: [/\/international\/search\/api\/search\/batchSearch/i],
    selectors: {
      resultContainer: [".flight-list.root-flights", ".result-wrapper", ".flight-list"],
      flightCard: [".flight-box", '[data-testid^="flight-item-"]', ".flight-item.domestic"],
      flightNumber: [".flight-airline .plane-No", ".flight-number", ".airline-name"],
      airlineName: [".flight-airline .airline-name", ".airline-item .airline-name"],
      departureTime: [".depart-box .time", ".depart-time", ".time-dep"],
      arrivalTime: [".arrive-box .time", ".arrive-time", ".time-arr"],
      departureAirport: [".depart-box .airport", ".depart-airport"],
      arrivalAirport: [".arrive-box .airport", ".arrive-airport"],
      price: [".flight-operate .flight-price .price", ".price-number", ".currency-price"],
    },
  },
  qunar: {
    metadata: {
      id: "qunar-browser",
      name: "去哪儿实时页面",
      kind: "ota",
      environment: "production",
      authorization: "browser_session",
      resultRole: "purchase_handoff",
      handoff: "deep_link",
      inventoryFamily: "qunar",
      configured: true,
      supportsFlexibleDateProbe: false,
      capabilities: {
        tripTypes: ["one_way", "round_trip"],
        markets: ["domestic_cn"],
        locationKinds: ["airport"],
        cabins: ["economy"],
        maxAdults: 9,
        roundTripMode: "split_ticket",
        priceEvidence: ["listed"],
        dataAccess: ["dom"],
        credentialRequirement: "browser_session",
        humanInteraction: "login_or_verification_possible",
        executionLocation: "server",
      },
    },
    buildUrl(intent) {
      const params = new URLSearchParams({
        searchDepartureAirport: cityName(intent.origin),
        searchArrivalAirport: cityName(intent.destination),
        searchDepartureTime: intent.departureDate,
      });
      return `https://flight.qunar.com/site/oneway_list.htm?${params.toString()}`;
    },
    responsePatterns: [/flight/i, /search/i],
    selectors: {
      resultContainer: [".e-airfly-list", ".e-airfly-wrap", ".b-airfly-list"],
      flightCard: [".e-airfly", ".b-airfly-item"],
      flightNumber: [".col-airline .num .n", ".air-code"],
      airlineName: [
        ".col-airline .d-air:first-child .air span",
        ".col-airline .d-air:first-child .airline-name",
      ],
      departureTime: [".sep-lf h2", ".time-dep"],
      arrivalTime: [".sep-rt h2", ".time-arr"],
      departureAirport: [".sep-lf .airport", ".airport-dep"],
      arrivalAirport: [".sep-rt .airport", ".airport-arr"],
      price: ['.col-price .prc[aria-label^="报价："]', ".b-airfly-price", ".price"],
    },
  },
  tongcheng: {
    metadata: {
      id: "tongcheng-browser",
      name: "同程实时页面",
      kind: "ota",
      environment: "production",
      authorization: "browser_session",
      resultRole: "purchase_handoff",
      handoff: "deep_link",
      inventoryFamily: "tongcheng",
      configured: true,
      supportsFlexibleDateProbe: false,
      capabilities: {
        tripTypes: ["one_way", "round_trip"],
        markets: ["domestic_cn"],
        locationKinds: ["airport"],
        cabins: ["economy"],
        maxAdults: 9,
        roundTripMode: "split_ticket",
        priceEvidence: ["listed"],
        dataAccess: ["dom"],
        credentialRequirement: "browser_session",
        humanInteraction: "login_or_verification_possible",
        executionLocation: "server",
      },
    },
    buildUrl(intent) {
      return `https://www.ly.com/flights/itinerary/oneway/${intent.origin.code}-${intent.destination.code}?date=${encodeURIComponent(intent.departureDate)}`;
    },
    responsePatterns: [/flight/i, /itinerary/i],
    selectors: {
      resultContainer: [".flight-list", ".flight-list-wrap", ".flight-list-container"],
      flightCard: [".flight-item"],
      flightNumber: [".flight-item-name"],
      airlineName: [".flight-item-name"],
      departureTime: [".f-startTime strong"],
      arrivalTime: [".f-endTime strong"],
      departureAirport: [".f-startTime em"],
      arrivalAirport: [".f-endTime em"],
      price: [".head-prices strong em", ".head-prices strong", ".price-show"],
    },
  },
  fliggy: {
    metadata: {
      id: "fliggy-browser",
      name: "飞猪实时页面",
      kind: "ota",
      environment: "production",
      authorization: "browser_session",
      resultRole: "purchase_handoff",
      handoff: "deep_link",
      inventoryFamily: "fliggy",
      configured: true,
      supportsFlexibleDateProbe: false,
      capabilities: {
        tripTypes: ["one_way", "round_trip"],
        markets: ["domestic_cn"],
        locationKinds: ["airport"],
        cabins: ["economy"],
        maxAdults: 9,
        roundTripMode: "split_ticket",
        priceEvidence: ["listed"],
        dataAccess: ["dom"],
        credentialRequirement: "browser_session",
        humanInteraction: "login_or_verification_possible",
        executionLocation: "server",
      },
    },
    buildUrl(intent) {
      const params = new URLSearchParams({
        tripType: "0",
        depCity: intent.origin.code,
        arrCity: intent.destination.code,
        depDate: intent.departureDate,
        depCityName: cityName(intent.origin),
        arrCityName: cityName(intent.destination),
      });
      return `https://sjipiao.fliggy.com/flight_search_result.htm?${params.toString()}`;
    },
    responsePatterns: [/flight/i, /search/i],
    selectors: {
      resultContainer: [".flight-list-box", ".flight-list.J_FlightList", ".flight-list-wrap"],
      flightCard: [".flight-list-item.J_FlightItem", ".flight-item-card"],
      flightNumber: [".flight-line .J_line", ".flight-line .airline-name", ".flight-no"],
      airlineName: [".flight-line .airline-name", ".airline-name"],
      departureTime: [".flight-time-deptime", ".dep-time"],
      arrivalTime: [".flight-time .s-time", ".arr-time"],
      departureAirport: [".flight-port .port-dep", ".dep-airport"],
      arrivalAirport: [".flight-port .port-arr", ".arr-airport"],
      price: [".flight-price .J_FlightListPrice", ".flight-price .pi-price", ".price-num"],
    },
  },
};

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function durationMinutes(value: unknown): number | undefined {
  const direct = number(value);
  if (direct && direct > 0) return Math.round(direct);
  const match = string(value)?.match(/(\d+(?:\.\d+)?)\s*(?:分钟|min)/i);
  return match ? Math.round(Number(match[1])) : undefined;
}

function localDateTime(value: unknown): string | undefined {
  const normalized = string(value)?.replace(" ", "T");
  if (!normalized) return undefined;
  const withoutZone = normalized.replace(/Z$/, "");
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(withoutZone)
    ? withoutZone
    : undefined;
}

function priceMinor(value: unknown): number | undefined {
  const normalized = string(value)?.replace(/[,，\s]/g, "");
  const match = normalized?.match(/(?:报价[:：]?|CNY|RMB|¥|￥)?(\d+(?:\.\d{1,2})?)/i);
  if (!match) return undefined;
  const parsed = Math.round(Number(match[1]) * 100);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function flightParts(value: string): { carrier: string; number: string } | undefined {
  const match = value.toUpperCase().match(/([A-Z][A-Z0-9])\s*(\d{3,4})(?!\d)/);
  return match ? { carrier: match[1]!, number: match[2]! } : undefined;
}

function safeCode(value: unknown, fallback: string): string {
  const candidate = string(value)?.toUpperCase();
  return candidate && /^[A-Z]{3}$/.test(candidate) ? candidate : fallback;
}

function inferredMinutes(departureAt: string, arrivalAt: string): number {
  const departure = new Date(`${departureAt}+08:00`).getTime();
  let arrival = new Date(`${arrivalAt}+08:00`).getTime();
  if (arrival <= departure) arrival += 86_400_000;
  return Math.max(1, Math.round((arrival - departure) / 60_000));
}

function airportSearchKey(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN")
    .replace(/国际|机场|航站楼|terminal|\bt\d+\b|[\s()（）'’-]+/g, "");
}

function airportRefFromText(
  value: string,
  fallback: SearchIntent["origin"],
): Offer["segments"][number]["origin"] {
  const haystack = airportSearchKey(value);
  const match = locationOptions.find((location) => {
    if (location.kind !== "airport") return false;
    const candidates = [location.airportNameZh, location.airportNameEn, ...location.aliases]
      .filter((candidate): candidate is string => Boolean(candidate))
      .map(airportSearchKey)
      .filter((candidate) => candidate.length >= 2);
    return candidates.some((candidate) => haystack.includes(candidate));
  });
  return match
    ? { kind: "airport", code: match.code, name: value }
    : { kind: fallback.kind, code: fallback.code, name: value };
}

function filterReasons(
  intent: SearchIntent,
  firstDepartureAt: string,
  maximumStops: number,
  rawText: string,
): string[] {
  const time = firstDepartureAt.slice(11, 16);
  return [
    ...(/会员|新客|券后|专享|银行卡/.test(rawText) ? ["CONDITIONAL_PRICE"] : []),
    ...(intent.directOnly && maximumStops > 0 ? ["MAX_STOPS_CONFLICT"] : []),
    ...(!intent.directOnly && maximumStops > intent.maxStops ? ["MAX_STOPS_CONFLICT"] : []),
    ...(intent.departureTime?.earliest && time < intent.departureTime.earliest
      ? ["DEPARTURE_TIME_CONFLICT"]
      : []),
    ...(intent.departureTime?.latest && time > intent.departureTime.latest
      ? ["DEPARTURE_TIME_CONFLICT"]
      : []),
    ...(intent.avoidRedEye && Number(time.slice(0, 2)) < 6 ? ["RED_EYE_CONFLICT"] : []),
    ...(intent.minimumCheckedBaggageKg > 0 ? ["CHECKED_BAGGAGE_UNVERIFIED"] : []),
  ];
}

function ctripContext(payload: unknown): {
  showAuthCode: boolean;
  needUserLogin: boolean;
  searchId?: string;
} {
  const data = object(object(payload)?.data);
  const context = object(data?.context);
  return {
    showAuthCode: context?.showAuthCode === true,
    needUserLogin: data?.needUserLogin === true,
    ...(string(context?.searchId) ? { searchId: string(context?.searchId)! } : {}),
  };
}

export function mapCtripBatchSearchPayload(
  payload: unknown,
  intent: SearchIntent,
  requestId: string,
  bookingUrl: string,
): Offer[] {
  const data = object(object(payload)?.data);
  const itineraries = array(data?.flightItineraryList);
  const fetchedAt = new Date().toISOString();

  return itineraries.flatMap((rawItinerary, itineraryIndex) => {
    const itinerary = object(rawItinerary);
    const price = object(array(itinerary?.priceList)[0]);
    const adultBase = number(price?.adultPrice);
    const adultTax = number(price?.adultTax) ?? 0;
    if (adultBase === undefined || adultBase < 0 || adultTax < 0) return [];

    const flightSegments = array(itinerary?.flightSegments);
    const segments: Offer["segments"] = [];
    const legs: Offer["legs"] = [];
    for (const [legIndex, rawFlightSegment] of flightSegments.entries()) {
      const flightList = array(object(rawFlightSegment)?.flightList);
      if (flightList.length === 0) return [];
      const legSegmentIds: string[] = [];
      for (const [segmentIndex, rawFlight] of flightList.entries()) {
        const flight = object(rawFlight);
        const parts = flightParts(string(flight?.flightNo) ?? "");
        const departureAt = localDateTime(flight?.departureDateTime);
        const arrivalAt = localDateTime(flight?.arrivalDateTime);
        if (!parts || !departureAt || !arrivalAt) return [];
        const segmentId = `ctrip:${requestId}:${itineraryIndex}:${legIndex}:${segmentIndex}`;
        legSegmentIds.push(segmentId);
        segments.push({
          id: segmentId,
          legIndex,
          marketingCarrier: string(flight?.marketAirlineCode)?.toUpperCase() ?? parts.carrier,
          flightNumber: parts.number,
          origin: {
            kind: "airport",
            code: safeCode(flight?.departureAirportCode, intent.origin.code),
            ...(string(flight?.departureAirportName)
              ? { name: string(flight?.departureAirportName)! }
              : {}),
          },
          destination: {
            kind: "airport",
            code: safeCode(flight?.arrivalAirportCode, intent.destination.code),
            ...(string(flight?.arrivalAirportName)
              ? { name: string(flight?.arrivalAirportName)! }
              : {}),
          },
          departureAt,
          arrivalAt,
          durationMinutes:
            durationMinutes(flight?.duration) ?? inferredMinutes(departureAt, arrivalAt),
          ...(string(flight?.aircraftCode) ? { aircraftCode: string(flight?.aircraftCode)! } : {}),
        });
      }
      const legSegments = segments.filter((segment) => segment.legIndex === legIndex);
      const first = legSegments[0];
      const last = legSegments.at(-1);
      if (!first || !last) return [];
      const airborne = legSegments.reduce((sum, segment) => sum + segment.durationMinutes, 0);
      legs.push({
        id: `ctrip:${requestId}:${itineraryIndex}:leg:${legIndex}`,
        segmentIds: legSegmentIds,
        origin: first.origin,
        destination: last.destination,
        departureAt: first.departureAt,
        arrivalAt: last.arrivalAt,
        durationMinutes: Math.max(
          airborne,
          durationMinutes(object(rawFlightSegment)?.duration) ?? airborne,
        ),
        stopCount: Math.max(0, legSegments.length - 1),
      });
    }
    if (legs.length === 0 || segments.length === 0) return [];

    const baseMinor = Math.round(adultBase * 100) * intent.adults;
    const taxMinor = Math.round(adultTax * 100) * intent.adults;
    const totalMinor = baseMinor + taxMinor;
    if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) return [];
    const reasons = filterReasons(
      intent,
      legs[0]!.departureAt,
      Math.max(...legs.map((leg) => leg.stopCount)),
      JSON.stringify(rawItinerary),
    );
    const sourceOfferId = string(itinerary?.itineraryId) ?? segments
      .map((segment) => `${segment.marketingCarrier}${segment.flightNumber}-${segment.departureAt}`)
      .join("|");
    const context = ctripContext(payload);

    return [{
      schemaVersion: "1" as const,
      id: `ctrip:${requestId}:${itineraryIndex}`,
      sourceOfferId,
      connectorId: "ctrip-browser",
      environment: "production" as const,
      seller: {
        id: "ctrip",
        name: "携程",
        kind: "ota" as const,
        deepLink: bookingUrl,
        handoffPrecision: "search_results" as const,
      },
      legs,
      segments,
      priceComponents: [
        {
          kind: "base" as const,
          label: intent.adults === 1 ? "成人票价" : `成人票价 × ${intent.adults}`,
          amountMinor: baseMinor,
          currency: "CNY",
          required: true,
        },
        {
          kind: "tax" as const,
          label: intent.adults === 1 ? "税费" : `税费 × ${intent.adults}`,
          amountMinor: taxMinor,
          currency: "CNY",
          required: true,
        },
      ],
      totalPrice: { amountMinor: totalMinor, currency: "CNY" },
      totalPriceCny: { amountMinor: totalMinor, currency: "CNY" },
      listedPrice: { amountMinor: totalMinor, currency: "CNY" },
      priceVerificationStatus: "provider_response_verified" as const,
      priceVerifiedAt: fetchedAt,
      baggage: [],
      refundable: null,
      changeable: null,
      eligibility: [],
      fetchedAt,
      evidenceRef: `${bookingUrl}#batchSearch:${context.searchId ?? requestId}`,
      comparable: reasons.length === 0,
      incomparabilityReasons: reasons,
      qualityScore: reasons.length === 0 ? 91 : 64,
    }];
  });
}

function domDateTime(date: string, time: string, nextDay: boolean): string | undefined {
  const match = time.match(/(\d{1,2}):(\d{2})/);
  if (!match) return undefined;
  const value = new Date(`${date}T12:00:00Z`);
  if (nextDay) value.setUTCDate(value.getUTCDate() + 1);
  return `${value.toISOString().slice(0, 10)}T${match[1]!.padStart(2, "0")}:${match[2]}:00`;
}

export function mapDomCards(
  cards: RawDomCard[],
  platform: BrowserOtaPlatform,
  intent: SearchIntent,
  requestId: string,
  bookingUrl: string,
  fetchedAt = new Date().toISOString(),
): Offer[] {
  const definition = DEFINITIONS[platform];
  return cards.slice(0, 30).flatMap((card, index) => {
    const parts = flightParts(card.flightNumberText || card.cardText);
    const perAdultMinor = priceMinor(card.priceText);
    const departureAt = domDateTime(intent.departureDate, card.departureTime, false);
    const nextDay = /\+1天|次日/.test(card.cardText) || card.arrivalTime < card.departureTime;
    const arrivalAt = domDateTime(intent.departureDate, card.arrivalTime, nextDay);
    if (
      !parts ||
      !perAdultMinor ||
      !departureAt ||
      !arrivalAt ||
      !card.departureAirport ||
      !card.arrivalAirport
    ) {
      return [];
    }
    const segmentId = `${platform}:${requestId}:${index}:segment`;
    const legId = `${platform}:${requestId}:${index}:leg`;
    const totalMinor = perAdultMinor * intent.adults;
    const stops = /中转|转机|转\d+次/.test(card.cardText) ? 1 : 0;
    const origin = airportRefFromText(card.departureAirport, intent.origin);
    const destination = airportRefFromText(card.arrivalAirport, intent.destination);
    const reasons = [
      ...filterReasons(intent, departureAt, stops, card.cardText),
      ...(intent.origin.kind === "airport" && origin.code !== intent.origin.code
        ? ["ORIGIN_AIRPORT_CONFLICT"]
        : []),
      ...(intent.destination.kind === "airport" && destination.code !== intent.destination.code
        ? ["DESTINATION_AIRPORT_CONFLICT"]
        : []),
    ];
    const providerResponseVerified = card.evidenceKind === "structured_response";
    return [{
      schemaVersion: "1" as const,
      id: `${platform}:${requestId}:${index}`,
      sourceOfferId: `${parts.carrier}${parts.number}-${departureAt}`,
      connectorId: definition.metadata.id,
      environment: "production" as const,
      seller: {
        id: platform,
        name: platform === "ctrip"
          ? "携程"
          : platform === "qunar"
            ? "去哪儿"
            : platform === "tongcheng"
              ? "同程旅行"
              : "飞猪",
        kind: "ota" as const,
        deepLink: bookingUrl,
        handoffPrecision: "search_results" as const,
      },
      legs: [{
        id: legId,
        segmentIds: [segmentId],
        origin,
        destination,
        departureAt,
        arrivalAt,
        durationMinutes: inferredMinutes(departureAt, arrivalAt),
        stopCount: stops,
      }],
      segments: [{
        id: segmentId,
        legIndex: 0,
        marketingCarrier: parts.carrier,
        flightNumber: parts.number,
        origin,
        destination,
        departureAt,
        arrivalAt,
        durationMinutes: inferredMinutes(departureAt, arrivalAt),
      }],
      priceComponents: [{
        kind: "required_service" as const,
        label: providerResponseVerified
          ? (intent.adults === 1 ? "来源结构化响应价" : `来源结构化响应价 × ${intent.adults}`)
          : (intent.adults === 1 ? "来源列表展示价" : `来源列表展示价 × ${intent.adults}`),
        amountMinor: totalMinor,
        currency: "CNY",
        required: true,
      }],
      totalPrice: { amountMinor: totalMinor, currency: "CNY" },
      totalPriceCny: { amountMinor: totalMinor, currency: "CNY" },
      listedPrice: { amountMinor: totalMinor, currency: "CNY" },
      priceVerificationStatus: providerResponseVerified
        ? "provider_response_verified" as const
        : "listed_only" as const,
      ...(providerResponseVerified ? { priceVerifiedAt: fetchedAt } : {}),
      baggage: [],
      refundable: null,
      changeable: null,
      eligibility: /会员|新客|券后|专享|银行卡/.test(card.cardText)
        ? ["CONDITIONAL_PRICE"]
        : [],
      fetchedAt,
      evidenceRef: bookingUrl,
      comparable: reasons.length === 0,
      incomparabilityReasons: reasons,
      qualityScore: providerResponseVerified
        ? (reasons.length === 0 ? 88 : 61)
        : (reasons.length === 0 ? 76 : 52),
    }];
  });
}

export function combineSplitTicketOffers(
  outbound: Offer[],
  inbound: Offer[],
  platform: BrowserOtaPlatform,
  requestId: string,
): Offer[] {
  const candidates = outbound
    .slice()
    .sort((left, right) => left.totalPrice.amountMinor - right.totalPrice.amountMinor)
    .slice(0, 4)
    .flatMap((outboundOffer) => inbound
      .slice()
      .sort((left, right) => left.totalPrice.amountMinor - right.totalPrice.amountMinor)
      .slice(0, 4)
      .map((inboundOffer) => ({ outboundOffer, inboundOffer })))
    .sort((left, right) =>
      left.outboundOffer.totalPrice.amountMinor + left.inboundOffer.totalPrice.amountMinor -
      right.outboundOffer.totalPrice.amountMinor - right.inboundOffer.totalPrice.amountMinor,
    )
    .slice(0, 10);

  return candidates.map(({ outboundOffer, inboundOffer }, index) => {
    const inboundSegments = inboundOffer.segments.map((segment) => ({
      ...segment,
      id: `${segment.id}:return`,
      legIndex: 1,
    }));
    const inboundLeg = inboundOffer.legs[0]!;
    const totalMinor = outboundOffer.totalPrice.amountMinor + inboundOffer.totalPrice.amountMinor;
    const outboundUrl = outboundOffer.seller.deepLink!;
    const inboundUrl = inboundOffer.seller.deepLink!;
    const fetchedAt = [outboundOffer.fetchedAt, inboundOffer.fetchedAt].sort().at(-1)!;
    return {
      ...outboundOffer,
      id: `${platform}:${requestId}:split:${index}`,
      sourceOfferId: `${outboundOffer.sourceOfferId}+${inboundOffer.sourceOfferId}`,
      seller: { ...outboundOffer.seller, deepLink: outboundUrl },
      purchaseMode: "split_ticket" as const,
      purchaseParts: [
        { legIndex: 0, label: "去程单独购买", price: outboundOffer.totalPrice, bookingUrl: outboundUrl, fetchedAt: outboundOffer.fetchedAt },
        { legIndex: 1, label: "返程单独购买", price: inboundOffer.totalPrice, bookingUrl: inboundUrl, fetchedAt: inboundOffer.fetchedAt },
      ],
      legs: [
        outboundOffer.legs[0]!,
        {
          ...inboundLeg,
          id: `${inboundLeg.id}:return`,
          segmentIds: inboundSegments.map((segment) => segment.id),
        },
      ],
      segments: [...outboundOffer.segments, ...inboundSegments],
      priceComponents: [
        { kind: "required_service" as const, label: "去程来源展示价", amountMinor: outboundOffer.totalPrice.amountMinor, currency: "CNY", required: true },
        { kind: "required_service" as const, label: "返程来源展示价", amountMinor: inboundOffer.totalPrice.amountMinor, currency: "CNY", required: true },
      ],
      totalPrice: { amountMinor: totalMinor, currency: "CNY" as const },
      totalPriceCny: { amountMinor: totalMinor, currency: "CNY" as const },
      listedPrice: { amountMinor: totalMinor, currency: "CNY" as const },
      fetchedAt,
      evidenceRef: outboundUrl,
      comparable: false,
      incomparabilityReasons: [
        ...new Set([
          ...outboundOffer.incomparabilityReasons,
          ...inboundOffer.incomparabilityReasons,
          "SPLIT_TICKET_SEPARATE_PURCHASES",
        ]),
      ],
      qualityScore: Math.min(outboundOffer.qualityScore, inboundOffer.qualityScore, 62),
    };
  });
}

async function extractDomCards(page: Page, definition: PlatformDefinition): Promise<RawDomCard[]> {
  const cardSelector = definition.selectors.flightCard.join(",");
  const cardLocators = await page.locator(cardSelector).all();
  const values: RawDomCard[] = [];
  for (const card of cardLocators.slice(0, 30)) {
    const from = async (candidates: string[]): Promise<string> => {
      for (const selector of candidates) {
        const element = card.locator(selector).first();
        if (await element.count() === 0) continue;
        const value = await element.getAttribute("aria-label") ?? await element.textContent();
        return value?.replace(/\s+/g, " ").trim() ?? "";
      }
      return "";
    };
    values.push({
      cardText: (await card.textContent())?.replace(/\s+/g, " ").trim() ?? "",
      flightNumberText: await from(definition.selectors.flightNumber),
      airlineName: await from(definition.selectors.airlineName),
      departureTime: await from(definition.selectors.departureTime),
      arrivalTime: await from(definition.selectors.arrivalTime),
      departureAirport: await from(definition.selectors.departureAirport),
      arrivalAirport: await from(definition.selectors.arrivalAirport),
      priceText: await from(definition.selectors.price),
    });
  }
  return values;
}

function blockingError(platform: BrowserOtaPlatform, bodyText: string): ConnectorError | undefined {
  if (/验证码|安全验证|滑块|访问过于频繁|verify you are human/i.test(bodyText)) {
    return new ConnectorError(
      `${platform} requires human verification.`,
      `${platform.toUpperCase()}_CAPTCHA_REQUIRED`,
      "captcha_required",
      false,
    );
  }
  if (/登录后查看|请先登录|账号登录|手机号登录/i.test(bodyText)) {
    return new ConnectorError(
      `${platform} requires an interactive login.`,
      `${platform.toUpperCase()}_LOGIN_REQUIRED`,
      "login_required",
      false,
    );
  }
  return undefined;
}

async function closeBrowser(browser: Browser | undefined): Promise<void> {
  if (!browser) return;
  await Promise.race([
    browser.close().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
  ]);
}

const COMPANION_STATE_DETAILS: Record<
  Exclude<CompanionJourneyResult["state"], "success" | "empty">,
  { state: "login_required" | "captcha_required" | "page_changed" | "unavailable" | "timeout"; retryable: boolean }
> = {
  login_required: { state: "login_required", retryable: false },
  captcha_required: { state: "captcha_required", retryable: false },
  page_changed: { state: "page_changed", retryable: false },
  unavailable: { state: "unavailable", retryable: true },
  timeout: { state: "timeout", retryable: true },
};

function throwForCompanionJourney(
  platform: BrowserOtaPlatform,
  journey: CompanionJourneyResult,
): void {
  if (journey.state === "success" || journey.state === "empty") return;
  const detail = COMPANION_STATE_DETAILS[journey.state];
  throw new ConnectorError(
    `${platform} Edge companion reported ${journey.state}.`,
    journey.errorCode ?? `${platform.toUpperCase()}_COMPANION_${journey.state.toUpperCase()}`,
    detail.state,
    detail.retryable,
  );
}

export class CompanionOtaConnector implements FlightConnector {
  readonly metadata: ConnectorMetadata;

  constructor(
    private readonly platform: BrowserOtaPlatform,
    private readonly result: CompanionPlatformResult,
  ) {
    const base = DEFINITIONS[platform].metadata;
    this.metadata = {
      ...base,
      id: `${platform}-edge-companion`,
      name: `${base.name.replace("实时页面", "")} · Edge`,
      supportsFlexibleDateProbe: false,
      capabilities: {
        ...base.capabilities!,
        tripTypes: ["one_way", "round_trip"],
        locationKinds: ["airport", "city"],
        roundTripMode: "split_ticket",
        dataAccess: this.platform === "ctrip" ? ["structured_response", "dom"] : ["dom"],
        credentialRequirement: "browser_session",
        humanInteraction: "login_or_verification_possible",
        executionLocation: "user_browser",
      },
    };
  }

  async health(): Promise<ConnectorHealth> {
    return {
      state: "healthy",
      checkedAt: new Date().toISOString(),
      detail: "Search evidence was collected in the user's Edge session.",
    };
  }

  async search(
    intent: SearchIntent,
    context: ConnectorSearchContext,
  ): Promise<ConnectorSearchResult> {
    const outbound = this.result.journeys.find((journey) => journey.direction === "outbound");
    if (!outbound) {
      throw new ConnectorError(
        `${this.platform} companion omitted the outbound journey.`,
        `${this.platform.toUpperCase()}_COMPANION_INVALID_RESPONSE`,
        "invalid_response",
        false,
      );
    }
    throwForCompanionJourney(this.platform, outbound);
    const outboundOffers = this.mapJourney(outbound, intent, `${context.requestId}:outbound`);
    if (intent.tripType === "one_way") {
      return {
        offers: outboundOffers,
        providerRequestId: context.requestId,
        notes: [`${this.platform.toUpperCase()}_EDGE_COMPANION_SESSION`],
      };
    }

    const inbound = this.result.journeys.find((journey) => journey.direction === "inbound");
    if (!inbound) {
      throw new ConnectorError(
        `${this.platform} companion omitted the inbound journey.`,
        `${this.platform.toUpperCase()}_COMPANION_INVALID_RESPONSE`,
        "invalid_response",
        false,
      );
    }
    throwForCompanionJourney(this.platform, inbound);
    const inboundIntent: SearchIntent = {
      ...intent,
      tripType: "one_way",
      origin: intent.destination,
      destination: intent.origin,
      departureDate: intent.returnDate!,
      returnDate: undefined,
    };
    const inboundOffers = this.mapJourney(inbound, inboundIntent, `${context.requestId}:inbound`);
    return {
      offers: combineSplitTicketOffers(
        outboundOffers,
        inboundOffers,
        this.platform,
        context.requestId,
      ).map((offer) => ({ ...offer, connectorId: this.metadata.id })),
      providerRequestId: context.requestId,
      notes: [
        `${this.platform.toUpperCase()}_EDGE_COMPANION_SESSION`,
        `${this.platform.toUpperCase()}_ROUND_TRIP_SPLIT_TICKET`,
      ],
    };
  }

  private mapJourney(
    journey: CompanionJourneyResult,
    intent: SearchIntent,
    requestId: string,
  ): Offer[] {
    return mapDomCards(
      journey.cards,
      this.platform,
      intent,
      requestId,
      journey.bookingUrl,
      journey.fetchedAt,
    ).map((offer) => ({ ...offer, connectorId: this.metadata.id }));
  }
}

export class BrowserOtaConnector implements FlightConnector {
  readonly metadata: ConnectorMetadata;
  private readonly definition: PlatformDefinition;

  constructor(private readonly config: BrowserOtaConfig) {
    this.definition = DEFINITIONS[config.platform];
    this.metadata = this.definition.metadata;
  }

  async health(): Promise<ConnectorHealth> {
    if (!this.config.executablePath) {
      return {
        state: "degraded",
        checkedAt: new Date().toISOString(),
        detail: "No system browser path configured; Playwright will use its bundled browser.",
      };
    }
    try {
      await access(this.config.executablePath);
      return {
        state: "healthy",
        checkedAt: new Date().toISOString(),
        detail: "An isolated system browser is available for live page search.",
      };
    } catch {
      return {
        state: "unavailable",
        checkedAt: new Date().toISOString(),
        detail: `Browser executable not found: ${this.config.executablePath}`,
      };
    }
  }

  async search(
    intent: SearchIntent,
    context: ConnectorSearchContext,
  ): Promise<ConnectorSearchResult> {
    if (intent.tripType === "round_trip" && this.config.platform !== "ctrip") {
      const outboundIntent: SearchIntent = { ...intent, tripType: "one_way", returnDate: undefined };
      const inboundIntent: SearchIntent = {
        ...intent,
        tripType: "one_way",
        origin: intent.destination,
        destination: intent.origin,
        departureDate: intent.returnDate!,
        returnDate: undefined,
      };
      const [outbound, inbound] = await Promise.all([
        this.search(outboundIntent, {
          ...context,
          requestId: `${context.requestId}:outbound`,
        }),
        this.search(inboundIntent, {
          ...context,
          requestId: `${context.requestId}:inbound`,
        }),
      ]);
      return {
        offers: combineSplitTicketOffers(
          outbound.offers,
          inbound.offers,
          this.config.platform,
          context.requestId,
        ),
        providerRequestId: context.requestId,
        notes: [
          ...(outbound.notes ?? []),
          ...(inbound.notes ?? []),
          `${this.config.platform.toUpperCase()}_ROUND_TRIP_SPLIT_TICKET`,
        ],
      };
    }

    let browser: Browser | undefined;
    const responsePayloads: unknown[] = [];
    const responseTasks: Promise<void>[] = [];
    const bookingUrl = this.definition.buildUrl(intent);
    const abort = () => void closeBrowser(browser);
    context.signal.addEventListener("abort", abort, { once: true });
    try {
      browser = await chromium.launch({
        headless: this.config.headless ?? true,
        ...(this.config.executablePath ? { executablePath: this.config.executablePath } : {}),
        ...(this.config.proxyServer ? { proxy: { server: this.config.proxyServer } } : {}),
      });
      const page = await browser.newPage({ locale: "zh-CN" });
      const timeout = this.config.navigationTimeoutMs ?? 18_000;
      page.setDefaultTimeout(timeout);
      page.on("response", (response) => {
        if (!this.definition.responsePatterns.some((pattern) => pattern.test(response.url()))) return;
        const task = response.json()
          .then((payload: unknown) => {
            responsePayloads.push(payload);
          })
          .catch(() => undefined);
        responseTasks.push(task);
      });
      await page.goto(bookingUrl, { waitUntil: "domcontentloaded", timeout });
      const resultSelector = this.definition.selectors.resultContainer.join(",");
      await page.locator(resultSelector).first().waitFor({ state: "attached", timeout }).catch(() => undefined);
      await page.waitForTimeout(1_500);
      await Promise.allSettled(responseTasks);

      if (this.config.platform === "ctrip") {
        for (const payload of responsePayloads) {
          const contextState = ctripContext(payload);
          if (contextState.showAuthCode) {
            throw new ConnectorError(
              "Ctrip batchSearch requested a security verification.",
              "CTRIP_CAPTCHA_REQUIRED",
              "captcha_required",
              false,
            );
          }
          if (contextState.needUserLogin) {
            throw new ConnectorError(
              "Ctrip batchSearch requires login.",
              "CTRIP_LOGIN_REQUIRED",
              "login_required",
              false,
            );
          }
          const networkOffers = mapCtripBatchSearchPayload(
            payload,
            intent,
            context.requestId,
            bookingUrl,
          );
          if (networkOffers.length > 0) {
            return {
              offers: networkOffers,
              ...(contextState.searchId ? { providerRequestId: contextState.searchId } : {}),
              notes: [
                "CTRIP_BATCH_SEARCH_RESPONSE",
                "CTRIP_PRICE_INCLUDES_ADULT_BASE_AND_TAX",
                "CTRIP_SOURCE_PAGE_REVALIDATION_REQUIRED",
              ],
            };
          }
        }
      }

      const bodyText = await page.locator("body").innerText().catch(() => "");
      const blocked = blockingError(this.config.platform, bodyText);
      if (blocked) throw blocked;
      const cards = await extractDomCards(page, this.definition);
      if (cards.length === 0) {
        if (/暂无.{0,8}航班|没有.{0,8}航班|未查询到.{0,8}航班|无符合.{0,8}航班/.test(bodyText)) {
          return {
            offers: [],
            providerRequestId: context.requestId,
            notes: [`${this.config.platform.toUpperCase()}_EXPLICIT_EMPTY_RESULT`],
          };
        }
        const title = await page.title().catch(() => "");
        throw new ConnectorError(
          `${this.config.platform} result cards were not found (${title || "untitled"}).`,
          `${this.config.platform.toUpperCase()}_PAGE_CHANGED`,
          "page_changed",
          false,
        );
      }
      const offers = mapDomCards(
        cards,
        this.config.platform,
        intent,
        context.requestId,
        bookingUrl,
      );
      if (cards.length > 0 && offers.length === 0) {
        throw new ConnectorError(
          `${this.config.platform} cards were visible but no longer matched the verified schema.`,
          `${this.config.platform.toUpperCase()}_PAGE_CHANGED`,
          "page_changed",
          false,
        );
      }
      return {
        offers,
        providerRequestId: context.requestId,
        notes: [
          `${this.config.platform.toUpperCase()}_LIVE_DOM_FALLBACK`,
          `${this.config.platform.toUpperCase()}_LIST_PRICE_REQUIRES_SOURCE_REVALIDATION`,
          `NETWORK_JSON_RESPONSES_OBSERVED:${responsePayloads.length}`,
        ],
      };
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      if (context.signal.aborted) throw new DOMException("Browser search aborted.", "AbortError");
      throw new ConnectorError(
        `${this.config.platform} browser search failed: ${error instanceof Error ? error.message : String(error)}`,
        `${this.config.platform.toUpperCase()}_BROWSER_FAILED`,
        "provider_error",
        true,
      );
    } finally {
      context.signal.removeEventListener("abort", abort);
      await closeBrowser(browser);
    }
  }
}
