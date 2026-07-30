import type { ConnectorReport, Offer, SearchIntent } from "@flight-lens/contracts";

export type ConnectorEnvironment = "sandbox" | "production";

export type ConnectorMetadata = {
  id: string;
  name: string;
  kind: "airline" | "ota" | "metasearch" | "aggregator";
  environment: ConnectorEnvironment;
  authorization: "contract" | "self_service_api" | "partner_api";
  configured: boolean;
};

export type ConnectorHealth = {
  state: "healthy" | "degraded" | "unavailable" | "unconfigured";
  checkedAt: string;
  detail?: string;
};

export type ConnectorSearchContext = {
  requestId: string;
  signal: AbortSignal;
};

export type ConnectorSearchResult = {
  offers: Offer[];
  providerRequestId?: string;
};

export interface FlightConnector {
  readonly metadata: ConnectorMetadata;
  health(signal: AbortSignal): Promise<ConnectorHealth>;
  search(intent: SearchIntent, context: ConnectorSearchContext): Promise<ConnectorSearchResult>;
}

export type ConnectorExecution = {
  result: ConnectorSearchResult;
  report: ConnectorReport;
};

function reportState(error: unknown): Pick<ConnectorReport, "state" | "errorCode" | "retryable"> {
  if (error instanceof ConnectorError) {
    return { state: error.state, errorCode: error.code, retryable: error.retryable };
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return { state: "timeout", errorCode: "CONNECTOR_TIMEOUT", retryable: true };
  }
  return { state: "provider_error", errorCode: "UNEXPECTED_CONNECTOR_ERROR", retryable: true };
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly state: ConnectorReport["state"],
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

export async function executeConnector(
  connector: FlightConnector,
  intent: SearchIntent,
  requestId: string,
  timeoutMs: number,
): Promise<ConnectorExecution> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("connector_timeout"), timeoutMs);

  try {
    const result = await connector.search(intent, { requestId, signal: controller.signal });
    const finished = Date.now();
    return {
      result,
      report: {
        connectorId: connector.metadata.id,
        connectorName: connector.metadata.name,
        state: result.offers.length === 0 ? "empty" : "success",
        startedAt,
        finishedAt: new Date(finished).toISOString(),
        durationMs: finished - started,
        offerCount: result.offers.length,
        retryable: false,
      },
    };
  } catch (error) {
    const finished = Date.now();
    const classified = reportState(error);
    return {
      result: { offers: [] },
      report: {
        connectorId: connector.metadata.id,
        connectorName: connector.metadata.name,
        ...classified,
        startedAt,
        finishedAt: new Date(finished).toISOString(),
        durationMs: finished - started,
        offerCount: 0,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export type ConnectorRegistryConfig = {
  amadeusClientId?: string;
  amadeusClientSecret?: string;
  amadeusBaseUrl?: string;
  duffelAccessToken?: string;
  duffelBaseUrl?: string;
};

export function createConnectorRegistry(config: ConnectorRegistryConfig): FlightConnector[] {
  const connectors: FlightConnector[] = [];
  if (config.amadeusClientId && config.amadeusClientSecret) {
    connectors.push(
      new AmadeusConnector({
        clientId: config.amadeusClientId,
        clientSecret: config.amadeusClientSecret,
        baseUrl: config.amadeusBaseUrl ?? "https://test.api.amadeus.com",
      }),
    );
  }
  if (config.duffelAccessToken) {
    connectors.push(
      new DuffelConnector({
        accessToken: config.duffelAccessToken,
        baseUrl: config.duffelBaseUrl ?? "https://api.duffel.com",
      }),
    );
  }
  return connectors;
}

type AmadeusConfig = {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
};

type AmadeusToken = { access_token?: string; expires_in?: number };

export class AmadeusConnector implements FlightConnector {
  readonly metadata: ConnectorMetadata;
  private token: { value: string; expiresAt: number } | undefined;

  constructor(private readonly config: AmadeusConfig) {
    this.metadata = {
      id: "amadeus-self-service",
      name: "Amadeus Self-Service",
      kind: "aggregator",
      environment: config.baseUrl.includes("test.") ? "sandbox" : "production",
      authorization: "self_service_api",
      configured: true,
    };
  }

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

  async search(intent: SearchIntent, context: ConnectorSearchContext): Promise<ConnectorSearchResult> {
    const token = await this.accessToken(context.signal);
    const url = new URL("/v2/shopping/flight-offers", this.config.baseUrl);
    url.searchParams.set("originLocationCode", intent.origin.code);
    url.searchParams.set("destinationLocationCode", intent.destination.code);
    url.searchParams.set("departureDate", intent.departureDate);
    if (intent.returnDate) url.searchParams.set("returnDate", intent.returnDate);
    url.searchParams.set("adults", String(intent.adults));
    url.searchParams.set("travelClass", "ECONOMY");
    url.searchParams.set("currencyCode", "CNY");
    url.searchParams.set("max", "50");
    if (intent.directOnly) url.searchParams.set("nonStop", "true");

    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: context.signal,
    });
    if (!response.ok) throw await providerHttpError("AMADEUS", response);
    const payload = (await response.json()) as {
      meta?: { count?: number };
      data?: unknown[];
    };
    const providerRequestId = response.headers.get("ama-request-id");
    return {
      offers: (payload.data ?? []).flatMap((item) =>
        mapAmadeusOffer(item, this.metadata.environment, context.requestId),
      ),
      ...(providerRequestId ? { providerRequestId } : {}),
    };
  }

  private async accessToken(signal: AbortSignal): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
    const response = await fetch(new URL("/v1/security/oauth2/token", this.config.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal,
    });
    if (!response.ok) throw await providerHttpError("AMADEUS_AUTH", response);
    const payload = (await response.json()) as AmadeusToken;
    if (!payload.access_token) {
      throw new ConnectorError("Amadeus token response was invalid.", "AMADEUS_INVALID_TOKEN", "invalid_response", false);
    }
    this.token = {
      value: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 900) * 1_000,
    };
    return this.token.value;
  }
}

type DuffelConfig = { accessToken: string; baseUrl: string };

export class DuffelConnector implements FlightConnector {
  readonly metadata: ConnectorMetadata;

  constructor(private readonly config: DuffelConfig) {
    this.metadata = {
      id: "duffel-flights",
      name: "Duffel Flights",
      kind: "aggregator",
      environment: config.accessToken.startsWith("duffel_test_") ? "sandbox" : "production",
      authorization: "self_service_api",
      configured: true,
    };
  }

  async health(signal: AbortSignal): Promise<ConnectorHealth> {
    try {
      const response = await fetch(new URL("/air/airlines?limit=1", this.config.baseUrl), {
        headers: this.headers(),
        signal,
      });
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

  async search(intent: SearchIntent, context: ConnectorSearchContext): Promise<ConnectorSearchResult> {
    const slices = [
      {
        origin: intent.origin.code,
        destination: intent.destination.code,
        departure_date: intent.departureDate,
      },
    ];
    if (intent.returnDate) {
      slices.push({
        origin: intent.destination.code,
        destination: intent.origin.code,
        departure_date: intent.returnDate,
      });
    }

    const response = await fetch(new URL("/air/offer_requests?return_offers=true", this.config.baseUrl), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        data: {
          slices,
          passengers: Array.from({ length: intent.adults }, (_, index) => ({
            id: `adult-${index + 1}`,
            type: "adult",
          })),
          cabin_class: "economy",
          max_connections: intent.directOnly ? 0 : intent.maxStops,
        },
      }),
      signal: context.signal,
    });
    if (!response.ok) throw await providerHttpError("DUFFEL", response);
    const payload = (await response.json()) as {
      data?: { id?: string; offers?: unknown[] };
    };
    const providerRequestId = payload.data?.id;
    return {
      offers: (payload.data?.offers ?? []).flatMap((item) =>
        mapDuffelOffer(item, this.metadata.environment, context.requestId),
      ),
      ...(providerRequestId ? { providerRequestId } : {}),
    };
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.config.accessToken}`,
      "content-type": "application/json",
      accept: "application/json",
      "duffel-version": "v2",
    };
  }
}

async function providerHttpError(prefix: string, response: Response): Promise<ConnectorError> {
  const body = (await response.text()).slice(0, 500);
  if ([401, 403].includes(response.status)) {
    return new ConnectorError(`${prefix} authentication failed.`, `${prefix}_AUTH`, "auth_error", false);
  }
  if (response.status === 429) {
    return new ConnectorError(`${prefix} rate limit reached.`, `${prefix}_RATE_LIMIT`, "rate_limited", true);
  }
  return new ConnectorError(
    `${prefix} returned HTTP ${response.status}: ${body}`,
    `${prefix}_HTTP_${response.status}`,
    "provider_error",
    response.status >= 500,
  );
}

function amountMinor(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) return undefined;
  return Math.round(Number(value) * 100);
}

function durationMinutes(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(value);
  if (!match) return undefined;
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
}

function mapAmadeusOffer(
  value: unknown,
  environment: ConnectorEnvironment,
  requestId: string,
): Offer[] {
  if (!value || typeof value !== "object") return [];
  const item = value as Record<string, unknown>;
  const price = item.price as Record<string, unknown> | undefined;
  const total = amountMinor(price?.grandTotal);
  const base = amountMinor(price?.base);
  const currency = typeof price?.currency === "string" ? price.currency : undefined;
  const itineraries = Array.isArray(item.itineraries) ? item.itineraries : [];
  if (total === undefined || base === undefined || !currency || itineraries.length === 0) return [];

  const segments: Offer["segments"] = [];
  for (const itineraryValue of itineraries) {
    if (!itineraryValue || typeof itineraryValue !== "object") return [];
    const itinerary = itineraryValue as Record<string, unknown>;
    const rawSegments = Array.isArray(itinerary.segments) ? itinerary.segments : [];
    for (const segmentValue of rawSegments) {
      if (!segmentValue || typeof segmentValue !== "object") return [];
      const segment = segmentValue as Record<string, unknown>;
      const departure = segment.departure as Record<string, unknown> | undefined;
      const arrival = segment.arrival as Record<string, unknown> | undefined;
      const operating = segment.operating as Record<string, unknown> | undefined;
      const aircraft = segment.aircraft as Record<string, unknown> | undefined;
      if (
        typeof segment.id !== "string" ||
        typeof segment.carrierCode !== "string" ||
        typeof segment.number !== "string" ||
        typeof departure?.iataCode !== "string" ||
        typeof departure.at !== "string" ||
        typeof arrival?.iataCode !== "string" ||
        typeof arrival.at !== "string"
      ) return [];
      const parsedDuration = durationMinutes(segment.duration);
      if (!parsedDuration) return [];
      const operatingCarrier =
        typeof operating?.carrierCode === "string" ? operating.carrierCode : undefined;
      const aircraftCode = typeof aircraft?.code === "string" ? aircraft.code : undefined;
      segments.push({
        id: segment.id,
        marketingCarrier: segment.carrierCode,
        ...(operatingCarrier ? { operatingCarrier } : {}),
        flightNumber: segment.number,
        origin: { kind: "airport", code: departure.iataCode },
        destination: { kind: "airport", code: arrival.iataCode },
        departureAt: departure.at,
        arrivalAt: arrival.at,
        durationMinutes: parsedDuration,
        ...(aircraftCode ? { aircraftCode } : {}),
      });
    }
  }

  const id = typeof item.id === "string" ? item.id : `${requestId}-${segments[0]?.id ?? "offer"}`;
  const tax = Math.max(0, total - base);
  return [{
    schemaVersion: "1",
    id: `amadeus:${id}`,
    sourceOfferId: id,
    connectorId: "amadeus-self-service",
    environment,
    seller: { id: "amadeus", name: "Amadeus", kind: "aggregator" },
    segments,
    priceComponents: [
      { kind: "base", label: "基础票价", amountMinor: base, currency, required: true },
      { kind: "tax", label: "税费与附加费", amountMinor: tax, currency, required: true },
    ],
    totalPrice: { amountMinor: total, currency },
    ...(currency === "CNY"
      ? { totalPriceCny: { amountMinor: total, currency: "CNY" as const } }
      : {}),
    baggage: [],
    refundable: Boolean(item.refundable),
    changeable: null,
    eligibility: [],
    fetchedAt: new Date().toISOString(),
    comparable: currency === "CNY",
    incomparabilityReasons: currency === "CNY" ? [] : ["FX_RATE_REQUIRED"],
    qualityScore: 72,
  }];
}

function mapDuffelOffer(
  value: unknown,
  environment: ConnectorEnvironment,
  requestId: string,
): Offer[] {
  if (!value || typeof value !== "object") return [];
  const item = value as Record<string, unknown>;
  const total = amountMinor(item.total_amount);
  const base = amountMinor(item.base_amount);
  const tax = amountMinor(item.tax_amount);
  const currency = typeof item.total_currency === "string" ? item.total_currency : undefined;
  const slices = Array.isArray(item.slices) ? item.slices : [];
  if (total === undefined || base === undefined || tax === undefined || !currency || slices.length === 0) return [];
  const segments: Offer["segments"] = [];

  for (const sliceValue of slices) {
    if (!sliceValue || typeof sliceValue !== "object") return [];
    const slice = sliceValue as Record<string, unknown>;
    for (const segmentValue of Array.isArray(slice.segments) ? slice.segments : []) {
      if (!segmentValue || typeof segmentValue !== "object") return [];
      const segment = segmentValue as Record<string, unknown>;
      const origin = segment.origin as Record<string, unknown> | undefined;
      const destination = segment.destination as Record<string, unknown> | undefined;
      const marketingCarrier = segment.marketing_carrier as Record<string, unknown> | undefined;
      const operatingCarrier = segment.operating_carrier as Record<string, unknown> | undefined;
      const duration = durationMinutes(segment.duration);
      if (
        typeof segment.id !== "string" ||
        typeof segment.marketing_carrier_flight_number !== "string" ||
        typeof origin?.iata_code !== "string" ||
        typeof destination?.iata_code !== "string" ||
        typeof segment.departing_at !== "string" ||
        typeof segment.arriving_at !== "string" ||
        typeof marketingCarrier?.iata_code !== "string" ||
        !duration
      ) return [];
      const operatingCarrierCode =
        typeof operatingCarrier?.iata_code === "string" ? operatingCarrier.iata_code : undefined;
      const aircraftCode = typeof segment.aircraft === "string" ? segment.aircraft : undefined;
      segments.push({
        id: segment.id,
        marketingCarrier: marketingCarrier.iata_code,
        ...(operatingCarrierCode ? { operatingCarrier: operatingCarrierCode } : {}),
        flightNumber: segment.marketing_carrier_flight_number,
        origin: { kind: "airport", code: origin.iata_code },
        destination: { kind: "airport", code: destination.iata_code },
        departureAt: segment.departing_at,
        arrivalAt: segment.arriving_at,
        durationMinutes: duration,
        ...(aircraftCode ? { aircraftCode } : {}),
      });
    }
  }

  const id = typeof item.id === "string" ? item.id : `${requestId}-${segments[0]?.id ?? "offer"}`;
  const owner = item.owner as Record<string, unknown> | undefined;
  return [{
    schemaVersion: "1",
    id: `duffel:${id}`,
    sourceOfferId: id,
    connectorId: "duffel-flights",
    environment,
    seller: {
      id: typeof owner?.id === "string" ? owner.id : "duffel",
      name: typeof owner?.name === "string" ? owner.name : "Duffel",
      kind: typeof owner?.name === "string" ? "airline" : "aggregator",
    },
    segments,
    priceComponents: [
      { kind: "base", label: "基础票价", amountMinor: base, currency, required: true },
      { kind: "tax", label: "税费与附加费", amountMinor: tax, currency, required: true },
    ],
    totalPrice: { amountMinor: total, currency },
    ...(currency === "CNY"
      ? { totalPriceCny: { amountMinor: total, currency: "CNY" as const } }
      : {}),
    baggage: [],
    refundable: null,
    changeable: null,
    eligibility: [],
    fetchedAt: new Date().toISOString(),
    ...(typeof item.expires_at === "string" ? { expiresAt: item.expires_at } : {}),
    comparable: currency === "CNY",
    incomparabilityReasons: currency === "CNY" ? [] : ["FX_RATE_REQUIRED"],
    qualityScore: 78,
  }];
}
