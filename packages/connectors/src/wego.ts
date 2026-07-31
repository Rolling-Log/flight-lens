import type { Offer, SearchIntent } from "@flight-lens/contracts";
import { ConnectorError, providerHttpError } from "./errors.js";
import type {
  ConnectorHealth,
  ConnectorMetadata,
  ConnectorSearchContext,
  ConnectorSearchResult,
  FlightConnector,
} from "./index.js";

type WegoConfig = {
  clientId: string;
  baseUrl: string;
  pollDelaysMs?: number[];
};

type WegoSearch = {
  id?: string;
};

type WegoSegment = {
  departureAirportCode?: string;
  arrivalAirportCode?: string;
  durationMinutes?: number;
  airlineCode?: string;
  operatingAirlineCode?: string;
  designatorCode?: string;
  departureDateTime?: string;
  arrivalDateTime?: string;
};

type WegoLeg = {
  id?: string;
  departureAirportCode?: string;
  arrivalAirportCode?: string;
  departureDateTime?: string;
  arrivalDateTime?: string;
  durationMinutes?: number;
  stopoversCount?: number;
  segments?: WegoSegment[];
};

type WegoTrip = {
  id?: string;
  legIds?: string[];
};

type WegoPrice = {
  totalAmount?: number;
  currencyCode?: string;
};

type WegoPaymentFee = {
  paymentMethodId?: number;
  currencyCode?: string;
  amount?: number;
};

type WegoFare = {
  id?: string;
  tripId?: string;
  providerCode?: string;
  handoffUrl?: string;
  price?: WegoPrice;
  paymentFees?: WegoPaymentFee[];
  refundable?: boolean;
  exchangeable?: boolean;
};

type WegoProvider = {
  code?: string;
  name?: string;
  type?: string;
};

type WegoAirport = {
  code?: string;
  name?: string;
};

export type WegoSearchPayload = {
  search?: WegoSearch;
  legs?: WegoLeg[];
  trips?: WegoTrip[];
  fares?: WegoFare[];
  providers?: WegoProvider[];
  airports?: WegoAirport[];
  count?: number;
};

function mergeCollection<T>(
  existing: T[] | undefined,
  incoming: T[] | undefined,
  identifier: (value: T) => string | undefined,
): T[] {
  const deduplicated = new Map<string, T>();
  for (const value of [...(existing ?? []), ...(incoming ?? [])]) {
    const id = identifier(value);
    if (id) deduplicated.set(id, value);
  }
  return [...deduplicated.values()];
}

function mergeWegoPayload(
  accumulated: WegoSearchPayload,
  incoming: WegoSearchPayload,
): WegoSearchPayload {
  const search = incoming.search?.id
    ? incoming.search
    : accumulated.search ?? incoming.search;
  const merged: WegoSearchPayload = {
    ...accumulated,
    ...incoming,
    ...(search ? { search } : {}),
    legs: mergeCollection(accumulated.legs, incoming.legs, (value) => value.id),
    trips: mergeCollection(accumulated.trips, incoming.trips, (value) => value.id),
    fares: mergeCollection(accumulated.fares, incoming.fares, (value) => value.id),
    providers: mergeCollection(
      accumulated.providers,
      incoming.providers,
      (value) => value.code,
    ),
    airports: mergeCollection(
      accumulated.airports,
      incoming.airports,
      (value) => value.code,
    ),
  };
  return merged;
}

function safeMinorAmount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  const minor = Math.round(value * 100);
  return Number.isSafeInteger(minor) ? minor : undefined;
}

function safeWegoHandoff(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "handoff.wego.com" &&
      url.pathname === "/flights/continue"
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizedIata(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9]{3}$/.test(code) ? code : undefined;
}

function normalizedCarrier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9]{2,3}$/.test(code) ? code : undefined;
}

function flightNumber(designator: unknown, carrier: string): string | undefined {
  if (typeof designator !== "string") return undefined;
  const compact = designator.replace(/\s+/g, "").toUpperCase();
  const withoutCarrier = compact.startsWith(carrier)
    ? compact.slice(carrier.length)
    : compact;
  return /^[A-Z0-9]+$/.test(withoutCarrier) ? withoutCarrier : undefined;
}

function safeDateTime(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
    value,
  )
    ? value
    : undefined;
}

function sellerKind(value: unknown): Offer["seller"]["kind"] {
  return value === "airline" ? "airline" : "ota";
}

function resolveWegoJourney(
  fare: WegoFare,
  payload: WegoSearchPayload,
  requestId: string,
): Pick<Offer, "legs" | "segments"> | undefined {
  const trip = payload.trips?.find((candidate) => candidate.id === fare.tripId);
  if (!trip?.legIds?.length) return undefined;
  const airportByCode = new Map(
    (payload.airports ?? [])
      .filter((airport): airport is WegoAirport & { code: string } =>
        typeof airport.code === "string")
      .map((airport) => [airport.code, airport]),
  );
  const legs: Offer["legs"] = [];
  const segments: Offer["segments"] = [];

  for (const [legIndex, legId] of trip.legIds.entries()) {
    const leg = payload.legs?.find((candidate) => candidate.id === legId);
    if (!leg?.segments?.length || typeof leg.id !== "string") return undefined;
    const segmentIds: string[] = [];

    for (const [segmentIndex, segment] of leg.segments.entries()) {
      const originCode = normalizedIata(segment.departureAirportCode);
      const destinationCode = normalizedIata(segment.arrivalAirportCode);
      const carrier = normalizedCarrier(segment.airlineCode);
      const operatingCarrier = normalizedCarrier(segment.operatingAirlineCode);
      const number = carrier ? flightNumber(segment.designatorCode, carrier) : undefined;
      const departureAt = safeDateTime(segment.departureDateTime);
      const arrivalAt = safeDateTime(segment.arrivalDateTime);
      if (
        !originCode ||
        !destinationCode ||
        !carrier ||
        !number ||
        !departureAt ||
        !arrivalAt ||
        !Number.isInteger(segment.durationMinutes) ||
        segment.durationMinutes! <= 0
      ) {
        return undefined;
      }
      const id = `wego:${requestId}:${leg.id}:segment-${segmentIndex}`;
      segmentIds.push(id);
      const originName = airportByCode.get(originCode)?.name;
      const destinationName = airportByCode.get(destinationCode)?.name;
      segments.push({
        id,
        legIndex,
        marketingCarrier: carrier,
        ...(operatingCarrier ? { operatingCarrier } : {}),
        flightNumber: number,
        origin: {
          kind: "airport",
          code: originCode,
          ...(originName ? { name: originName } : {}),
        },
        destination: {
          kind: "airport",
          code: destinationCode,
          ...(destinationName ? { name: destinationName } : {}),
        },
        departureAt,
        arrivalAt,
        durationMinutes: segment.durationMinutes!,
      });
    }

    const legSegments = segments.filter((segment) => segment.legIndex === legIndex);
    const first = legSegments[0];
    const last = legSegments.at(-1);
    if (!first || !last) return undefined;
    const airborneMinutes = legSegments.reduce(
      (total, segment) => total + segment.durationMinutes,
      0,
    );
    const providerDuration =
      Number.isInteger(leg.durationMinutes) && leg.durationMinutes! >= airborneMinutes
        ? leg.durationMinutes!
        : airborneMinutes;
    legs.push({
      id: `wego:${requestId}:${leg.id}`,
      segmentIds,
      origin: first.origin,
      destination: last.destination,
      departureAt: safeDateTime(leg.departureDateTime) ?? first.departureAt,
      arrivalAt: safeDateTime(leg.arrivalDateTime) ?? last.arrivalAt,
      durationMinutes: providerDuration,
      stopCount: Math.max(0, legSegments.length - 1),
    });
  }

  return { legs, segments };
}

export function mapWegoSearchResults(
  payload: WegoSearchPayload,
  requestId: string,
): Offer[] {
  const offers: Offer[] = [];
  for (const fare of payload.fares ?? []) {
    const sourceOfferId = fare.id;
    const total = safeMinorAmount(fare.price?.totalAmount);
    const currency =
      typeof fare.price?.currencyCode === "string"
        ? fare.price.currencyCode.toUpperCase()
        : undefined;
    const provider = payload.providers?.find(
      (candidate) => candidate.code === fare.providerCode,
    );
    const journey = resolveWegoJourney(fare, payload, requestId);
    if (
      !sourceOfferId ||
      total === undefined ||
      !currency ||
      !/^[A-Z]{3}$/.test(currency) ||
      !provider?.code ||
      !provider.name ||
      !journey
    ) {
      continue;
    }
    const deepLink = safeWegoHandoff(fare.handoffUrl);
    const incomparabilityReasons = [
      ...(currency === "CNY" ? [] : ["FX_RATE_REQUIRED"]),
      ...(deepLink ? [] : ["NO_PURCHASE_HANDOFF"]),
    ];
    const hasPaymentMethodFee = (fare.paymentFees ?? []).some(
      (fee) =>
        fee.currencyCode?.toUpperCase() === currency &&
        typeof fee.amount === "number" &&
        fee.amount > 0,
    );
    offers.push({
      schemaVersion: "1",
      id: `wego:${requestId}:${sourceOfferId}`,
      sourceOfferId,
      connectorId: "wego-affiliate-flights",
      environment: "production",
      seller: {
        id: provider.code,
        name: provider.name,
        kind: sellerKind(provider.type),
        ...(deepLink
          ? { deepLink, handoffPrecision: "exact_offer" as const }
          : {}),
      },
      ...journey,
      priceComponents: [{
        kind: "base",
        label: "Wego 返回的可支付总价（含已报告支付费）",
        amountMinor: total,
        currency,
        required: true,
      }],
      totalPrice: { amountMinor: total, currency },
      ...(currency === "CNY"
        ? { totalPriceCny: { amountMinor: total, currency: "CNY" as const } }
        : {}),
      baggage: [],
      fareBrand: "Economy",
      refundable: typeof fare.refundable === "boolean" ? fare.refundable : null,
      changeable: typeof fare.exchangeable === "boolean" ? fare.exchangeable : null,
      eligibility: hasPaymentMethodFee ? ["PAYMENT_METHOD_FEE_MAY_VARY"] : [],
      fetchedAt: new Date().toISOString(),
      evidenceRef: `wego:${payload.search?.id ?? "unknown"}:${sourceOfferId}`,
      comparable: incomparabilityReasons.length === 0,
      incomparabilityReasons,
      qualityScore: deepLink ? 90 : 65,
    });
  }
  return offers;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      signal.removeEventListener("abort", aborted);
      resolve();
    };
    const timeout = setTimeout(done, milliseconds);
    const aborted = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", aborted);
      reject(new DOMException("Wego polling aborted.", "AbortError"));
    };
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

export class WegoConnector implements FlightConnector {
  readonly metadata: ConnectorMetadata = {
    id: "wego-affiliate-flights",
    name: "Wego Affiliate Flights",
    kind: "metasearch",
    environment: "production",
    authorization: "partner_api",
    resultRole: "purchase_handoff",
    handoff: "deep_link",
    configured: true,
    supportsFlexibleDateProbe: false,
  };
  private token: { value: string; expiresAt: number } | undefined;

  constructor(private readonly config: WegoConfig) {}

  async health(signal: AbortSignal): Promise<ConnectorHealth> {
    try {
      await this.accessToken(signal);
      return { state: "healthy", checkedAt: new Date().toISOString() };
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
    const token = await this.accessToken(context.signal);
    const legs = [{
      outboundDate: intent.departureDate,
      departureCityCode: intent.origin.code,
      arrivalCityCode: intent.destination.code,
    }];
    if (intent.returnDate) {
      legs.push({
        outboundDate: intent.returnDate,
        departureCityCode: intent.destination.code,
        arrivalCityCode: intent.origin.code,
      });
    }

    const startResponse = await fetch(
      new URL("/metasearch/flights/searches", this.config.baseUrl),
      {
        method: "POST",
        headers: this.headers(token),
        body: JSON.stringify({
          paymentMethodIds: [10, 14, 15],
          search: {
            adultsCount: intent.adults,
            appType: "WEB_APP",
            cabin: intent.cabin,
            childrenCount: 0,
            clientCreatedAt: new Date().toISOString(),
            currencyCode: "CNY",
            deviceType: "DESKTOP",
            infantsCount: 0,
            legs,
            locale: "zh",
            siteCode: "CN",
            userLoggedIn: false,
            showWegoFares: false,
            showWegoFaresOnly: false,
          },
        }),
        signal: context.signal,
      },
    );
    if (!startResponse.ok) throw await providerHttpError("WEGO", startResponse);
    let payload = (await startResponse.json()) as WegoSearchPayload;
    const searchId = payload.search?.id;
    if (!searchId) {
      throw new ConnectorError(
        "Wego search response omitted the search ID.",
        "WEGO_INVALID_SEARCH_ID",
        "invalid_response",
        false,
      );
    }

    let previousCount = -1;
    let unchangedPolls = 0;
    let offset = 0;
    for (const delay of this.config.pollDelaysMs ??
      [500, 1_000, 2_000, 3_000, 4_000, 5_000, 6_000]) {
      await wait(delay, context.signal);
      const resultsUrl = new URL(
        `/metasearch/flights/searches/${encodeURIComponent(searchId)}/results`,
        this.config.baseUrl,
      );
      resultsUrl.searchParams.set("offset", String(offset));
      resultsUrl.searchParams.set("locale", "zh");
      resultsUrl.searchParams.set("currencyCode", "CNY");
      const response = await fetch(resultsUrl, {
        headers: this.headers(token),
        signal: context.signal,
      });
      if (!response.ok) throw await providerHttpError("WEGO", response);
      const incoming = (await response.json()) as WegoSearchPayload;
      payload = mergeWegoPayload(payload, incoming);
      const currentCount =
        Number.isInteger(incoming.count) && incoming.count! >= 0
          ? incoming.count!
          : payload.fares?.length ?? 0;
      unchangedPolls = currentCount === previousCount ? unchangedPolls + 1 : 0;
      previousCount = currentCount;
      offset = currentCount;
      if (unchangedPolls >= 2) break;
    }

    return {
      offers: mapWegoSearchResults(payload, context.requestId),
      providerRequestId: searchId,
    };
  }

  private headers(token?: string): Record<string, string> {
    return {
      "content-type": "application/json",
      "x-wego-version": "1",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
  }

  private async accessToken(signal: AbortSignal): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) {
      return this.token.value;
    }
    const response = await fetch(new URL("/apps/oauth/token", this.config.baseUrl), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        client_id: this.config.clientId,
        grant_type: "client_credentials",
        scope: "affiliate",
      }),
      signal,
    });
    if (!response.ok) throw await providerHttpError("WEGO_AUTH", response);
    const payload = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!payload.access_token) {
      throw new ConnectorError(
        "Wego token response was invalid.",
        "WEGO_INVALID_TOKEN",
        "invalid_response",
        false,
      );
    }
    this.token = {
      value: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 43_200) * 1_000,
    };
    return this.token.value;
  }
}
