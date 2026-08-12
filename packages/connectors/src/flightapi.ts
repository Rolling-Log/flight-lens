import type { Offer, SearchIntent } from "@flight-lens/contracts";
import { ConnectorError, providerHttpError } from "./errors.js";
import type {
  ConnectorHealth,
  ConnectorMetadata,
  ConnectorSearchContext,
  ConnectorSearchResult,
  FlightConnector,
} from "./index.js";

type FlightApiConfig = {
  apiKey: string;
  baseUrl: string;
  maxSearchesPerProcess: number;
};

type FlightApiEntity = Record<string, unknown> & { id?: string | number };

export type FlightApiSearchPayload = {
  itineraries?: FlightApiEntity[];
  legs?: FlightApiEntity[];
  segments?: FlightApiEntity[];
  places?: FlightApiEntity[];
  carriers?: FlightApiEntity[];
  agents?: FlightApiEntity[];
  error?: unknown;
};

function keyed(values: FlightApiEntity[] | undefined): Map<string, FlightApiEntity> {
  return new Map(
    (values ?? []).flatMap((value) =>
      value.id === undefined ? [] : [[String(value.id), value] as const],
    ),
  );
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function idList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const normalized = stringValue(item);
        return normalized ? [normalized] : [];
      })
    : [];
}

function airportCode(value: FlightApiEntity | undefined): string | undefined {
  const code = stringValue(value?.iata ?? value?.display_code)?.toUpperCase();
  return code && /^[A-Z]{3}$/.test(code) ? code : undefined;
}

function carrierCode(value: FlightApiEntity | undefined): string | undefined {
  const code = stringValue(value?.iata ?? value?.display_code)?.toUpperCase();
  return code && /^[A-Z0-9]{2,3}$/.test(code) ? code : undefined;
}

function localDateTime(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.includes(" ") ? value.replace(" ", "T") : value;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(normalized)
    ? normalized.length === 16
      ? `${normalized}:00`
      : normalized
    : undefined;
}

function wholeCurrencyMinor(value: unknown): number | undefined {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  const minor = Math.round(amount * 100);
  return Number.isSafeInteger(minor) ? minor : undefined;
}

function skyscannerHandoff(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value, "https://www.skyscanner.com");
    if (url.protocol !== "https:" || !/(^|\.)skyscanner\.(com|net)$/.test(url.hostname)) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

function resolveJourney(
  itinerary: FlightApiEntity,
  payload: FlightApiSearchPayload,
  requestId: string,
): { legs: Offer["legs"]; segments: Offer["segments"]; maximumStops: number } | undefined {
  const legsById = keyed(payload.legs);
  const segmentsById = keyed(payload.segments);
  const placesById = keyed(payload.places);
  const carriersById = keyed(payload.carriers);
  const legs: Offer["legs"] = [];
  const segments: Offer["segments"] = [];
  let maximumStops = 0;

  for (const [legIndex, legId] of idList(itinerary.leg_ids).entries()) {
    const leg = legsById.get(legId);
    if (!leg) return undefined;
    const sourceSegmentIds = idList(leg.segment_ids);
    if (sourceSegmentIds.length === 0) return undefined;
    const normalizedSegmentIds: string[] = [];

    for (const segmentId of sourceSegmentIds) {
      const segment = segmentsById.get(segmentId);
      const origin = placesById.get(String(segment?.origin_place_id));
      const destination = placesById.get(String(segment?.destination_place_id));
      const marketingCarrier = carriersById.get(String(segment?.marketing_carrier_id));
      const operatingCarrier = carriersById.get(String(segment?.operating_carrier_id));
      const originCode = airportCode(origin);
      const destinationCode = airportCode(destination);
      const marketingCode = carrierCode(marketingCarrier);
      const operatingCode = carrierCode(operatingCarrier);
      const flightNumber = stringValue(segment?.marketing_flight_number);
      const departureAt = localDateTime(segment?.departure);
      const arrivalAt = localDateTime(segment?.arrival);
      const duration = Number(segment?.duration);
      if (
        !segment ||
        !originCode ||
        !destinationCode ||
        !marketingCode ||
        !flightNumber ||
        !departureAt ||
        !arrivalAt ||
        !Number.isInteger(duration) ||
        duration <= 0
      ) {
        return undefined;
      }
      const normalizedId = `flightapi:${requestId}:${segmentId}`;
      normalizedSegmentIds.push(normalizedId);
      segments.push({
        id: normalizedId,
        legIndex,
        marketingCarrier: marketingCode,
        ...(operatingCode ? { operatingCarrier: operatingCode } : {}),
        flightNumber,
        origin: { kind: "airport", code: originCode, ...(stringValue(origin?.name) ? { name: stringValue(origin?.name)! } : {}) },
        destination: { kind: "airport", code: destinationCode, ...(stringValue(destination?.name) ? { name: stringValue(destination?.name)! } : {}) },
        departureAt,
        arrivalAt,
        durationMinutes: duration,
      });
    }

    const legSegments = segments.filter((segment) => segment.legIndex === legIndex);
    const first = legSegments[0];
    const last = legSegments.at(-1);
    if (!first || !last) return undefined;
    const airborneMinutes = legSegments.reduce((sum, segment) => sum + segment.durationMinutes, 0);
    const providerDuration = Number(leg.duration);
    const stopCount = Math.max(0, sourceSegmentIds.length - 1);
    maximumStops = Math.max(maximumStops, stopCount);
    legs.push({
      id: `flightapi:${requestId}:${legId}`,
      segmentIds: normalizedSegmentIds,
      origin: first.origin,
      destination: last.destination,
      departureAt: first.departureAt,
      arrivalAt: last.arrivalAt,
      durationMinutes:
        Number.isInteger(providerDuration) && providerDuration >= airborneMinutes
          ? providerDuration
          : airborneMinutes,
      stopCount,
    });
  }

  return legs.length ? { legs, segments, maximumStops } : undefined;
}

export function mapFlightApiSearchPayload(
  payload: FlightApiSearchPayload,
  intent: SearchIntent,
  requestId: string,
): Offer[] {
  const agents = keyed(payload.agents);
  const offers: Offer[] = [];

  for (const [itineraryIndex, itinerary] of (payload.itineraries ?? []).entries()) {
    const journey = resolveJourney(itinerary, payload, requestId);
    if (!journey) continue;
    const itineraryId = stringValue(itinerary.id) ?? `itinerary-${itineraryIndex}`;
    const pricingOptions = Array.isArray(itinerary.pricing_options)
      ? itinerary.pricing_options.filter(
          (value): value is FlightApiEntity => Boolean(value && typeof value === "object"),
        )
      : [];

    for (const [optionIndex, option] of pricingOptions.entries()) {
      const price = option.price && typeof option.price === "object"
        ? option.price as FlightApiEntity
        : undefined;
      const totalMinor = wholeCurrencyMinor(price?.amount);
      const items = Array.isArray(option.items)
        ? option.items.filter(
            (value): value is FlightApiEntity => Boolean(value && typeof value === "object"),
          )
        : [];
      const soleItem = items.length === 1 ? items[0] : undefined;
      const itemAgentId = stringValue(soleItem?.agent_id);
      const agent = itemAgentId ? agents.get(itemAgentId) : undefined;
      const deepLink = skyscannerHandoff(soleItem?.url);
      if (totalMinor === undefined) continue;

      const transferType = stringValue(option.transfer_type)?.toUpperCase();
      const selfTransfer = Boolean(transferType && transferType !== "MANAGED");
      const tooManyStops = intent.directOnly
        ? journey.maximumStops > 0
        : journey.maximumStops > intent.maxStops;
      const reasons = [
        ...(deepLink ? [] : ["NO_PURCHASE_HANDOFF"]),
        ...(items.length === 1 ? [] : ["MULTIPLE_PURCHASE_HANDOFFS"]),
        ...(intent.minimumCheckedBaggageKg > 0 ? ["CHECKED_BAGGAGE_UNVERIFIED"] : []),
        ...(tooManyStops ? ["MAX_STOPS_CONFLICT"] : []),
        ...(selfTransfer ? ["SELF_TRANSFER"] : []),
        ...(intent.flexibleDays === 0 ? [] : ["FLEXIBLE_DATE_RANGE_NOT_EXPANDED"]),
      ];
      const sourceOfferId = stringValue(option.id) ?? `${itineraryId}:${optionIndex}`;
      const agentName = stringValue(agent?.name) ?? "FlightAPI 售卖方";
      const agentType = stringValue(agent?.type)?.toLowerCase();

      offers.push({
        schemaVersion: "1",
        id: `flightapi:${requestId}:${itineraryId}:${sourceOfferId}`,
        sourceOfferId,
        connectorId: "flightapi-skyscanner",
        environment: "production",
        seller: {
          id: itemAgentId ?? `flightapi:${sourceOfferId}`,
          name: agentName,
          kind: agentType?.includes("airline") ? "airline" : "ota",
          ...(deepLink ? { deepLink, handoffPrecision: "exact_offer" as const } : {}),
        },
        legs: journey.legs,
        segments: journey.segments,
        priceComponents: [{
          kind: "required_service",
          label: "FlightAPI 展示总价（Skyscanner 衍生数据，供应方未拆分）",
          amountMinor: totalMinor,
          currency: "CNY",
          required: true,
        }],
        totalPrice: { amountMinor: totalMinor, currency: "CNY" },
        totalPriceCny: { amountMinor: totalMinor, currency: "CNY" },
        baggage: [],
        refundable: null,
        changeable: null,
        eligibility: ["SKYSCANNER_DERIVED_SOURCE", ...(selfTransfer ? ["SELF_TRANSFER"] : [])],
        fetchedAt: new Date().toISOString(),
        evidenceRef: `flightapi:${itineraryId}:${sourceOfferId}`,
        comparable: reasons.length === 0,
        incomparabilityReasons: reasons,
        qualityScore: reasons.length === 0 ? 76 : 50,
      });
    }
  }
  return offers;
}

export class FlightApiConnector implements FlightConnector {
  readonly metadata: ConnectorMetadata = {
    id: "flightapi-skyscanner",
    name: "FlightAPI · Skyscanner-derived prices",
    kind: "metasearch",
    environment: "production",
    authorization: "self_service_api",
    resultRole: "purchase_handoff",
    handoff: "deep_link",
    inventoryFamily: "skyscanner-metasearch",
    configured: true,
    supportsFlexibleDateProbe: false,
  };
  private searchesUsed = 0;

  constructor(private readonly config: FlightApiConfig) {}

  async health(_signal: AbortSignal): Promise<ConnectorHealth> {
    return {
      state: this.searchesUsed < this.config.maxSearchesPerProcess ? "degraded" : "unavailable",
      checkedAt: new Date().toISOString(),
      detail:
        this.searchesUsed < this.config.maxSearchesPerProcess
          ? "Credential configured; no free health endpoint is called because each search consumes credits."
          : "The process-local FlightAPI search cap has been reached.",
    };
  }

  async search(intent: SearchIntent, context: ConnectorSearchContext): Promise<ConnectorSearchResult> {
    if (this.searchesUsed >= this.config.maxSearchesPerProcess) {
      throw new ConnectorError(
        "FlightAPI process-local search cap reached.",
        "FLIGHTAPI_PROCESS_CAP_REACHED",
        "rate_limited",
        false,
      );
    }
    this.searchesUsed += 1;
    const parts = [
      intent.tripType === "round_trip" ? "roundtrip" : "onewaytrip",
      this.config.apiKey,
      intent.origin.code,
      intent.destination.code,
      intent.departureDate,
      ...(intent.returnDate ? [intent.returnDate] : []),
      String(intent.adults),
      "0",
      "0",
      "Economy",
      "CNY",
    ];
    const url = new URL(parts.map(encodeURIComponent).join("/"), `${this.config.baseUrl.replace(/\/$/, "")}/`);
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: context.signal,
    });
    if (!response.ok) throw await providerHttpError("FLIGHTAPI", response);
    const payload = await response.json() as FlightApiSearchPayload;
    if (!payload || typeof payload !== "object") {
      throw new ConnectorError(
        "FlightAPI returned an invalid JSON response.",
        "FLIGHTAPI_INVALID_RESPONSE",
        "invalid_response",
        false,
      );
    }
    if (typeof payload.error === "string") {
      throw new ConnectorError(payload.error, "FLIGHTAPI_RESPONSE_ERROR", "provider_error", true);
    }
    return {
      offers: mapFlightApiSearchPayload(payload, intent, context.requestId),
      providerRequestId: context.requestId,
      notes: [
        "FLIGHTAPI_SKYSCANNER_DERIVED_SOURCE",
        "FLIGHTAPI_LOCAL_EXPERIMENTAL_RIGHTS_REVIEW_REQUIRED",
        `FLIGHTAPI_PROCESS_USAGE:${this.searchesUsed}/${this.config.maxSearchesPerProcess}`,
      ],
    };
  }
}
