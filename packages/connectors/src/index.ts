import type { ConnectorReport, Offer, SearchIntent } from "@flight-lens/contracts";
import { ConnectorError, providerHttpError } from "./errors.js";
import { SkyscannerConnector } from "./skyscanner.js";

export { ConnectorError } from "./errors.js";
export {
  SkyscannerConnector,
  mapSkyscannerSearchResults,
  type SkyscannerSearchPayload,
} from "./skyscanner.js";

export type ConnectorEnvironment = "sandbox" | "production";

export type ConnectorMetadata = {
  id: string;
  name: string;
  kind: "airline" | "ota" | "metasearch" | "aggregator";
  environment: ConnectorEnvironment;
  authorization: "contract" | "self_service_api" | "partner_api";
  resultRole: "discovery" | "verification" | "purchase_handoff";
  handoff: "none" | "deep_link" | "server_resolved";
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

export type ConnectorExecutionPolicy = {
  maxRetries?: number;
  cacheTtlMs?: number;
  staleIfErrorMs?: number;
};

type CachedConnectorExecution = ConnectorExecution & {
  cachedAt: number;
};

const executionCache = new Map<string, CachedConnectorExecution>();

export function clearConnectorExecutionCache(): void {
  executionCache.clear();
}

function executionCacheKey(connector: FlightConnector, intent: SearchIntent): string {
  return `${connector.metadata.id}:${JSON.stringify(intent)}`;
}

function cachedExecution(
  entry: CachedConnectorExecution,
  now: number,
  note: string,
  errorCode?: string,
): ConnectorExecution {
  return {
    result: entry.result,
    report: {
      ...entry.report,
      startedAt: new Date(now).toISOString(),
      finishedAt: new Date(now).toISOString(),
      durationMs: 0,
      ...(errorCode ? { errorCode } : {}),
      notes: [...entry.report.notes, note],
    },
  };
}

function canRetryImmediately(error: unknown): boolean {
  const classified = reportState(error);
  return (
    classified.retryable &&
    (classified.state === "provider_error" || classified.state === "unavailable")
  );
}

async function retryDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timeout = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      reject(new DOMException("Connector attempt aborted.", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

type VariantAttempt =
  | { status: "fulfilled"; value: ConnectorSearchResult; retries: number }
  | { status: "rejected"; reason: unknown; retries: number };

async function searchVariant(
  connector: FlightConnector,
  variant: SearchIntent,
  requestId: string,
  signal: AbortSignal,
  maxRetries: number,
): Promise<VariantAttempt> {
  let retries = 0;
  while (true) {
    try {
      const value = await connector.search(variant, { requestId, signal });
      return { status: "fulfilled", value, retries };
    } catch (error) {
      if (retries >= maxRetries || !canRetryImmediately(error) || signal.aborted) {
        return { status: "rejected", reason: error, retries };
      }
      retries += 1;
      try {
        await retryDelay(150 * retries, signal);
      } catch (abortError) {
        return { status: "rejected", reason: abortError, retries };
      }
    }
  }
}

function shiftedDate(date: string, dayOffset: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + dayOffset);
  return value.toISOString().slice(0, 10);
}

function searchVariants(intent: SearchIntent): SearchIntent[] {
  if (intent.flexibleDays === 0) return [intent];
  return [-intent.flexibleDays, 0, intent.flexibleDays].map((dayOffset) => ({
    ...intent,
    departureDate: shiftedDate(intent.departureDate, dayOffset),
    ...(intent.returnDate
      ? { returnDate: shiftedDate(intent.returnDate, dayOffset) }
      : {}),
    flexibleDays: 0,
  }));
}

function reportState(error: unknown): Pick<ConnectorReport, "state" | "errorCode" | "retryable"> {
  if (error instanceof ConnectorError) {
    return { state: error.state, errorCode: error.code, retryable: error.retryable };
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return { state: "timeout", errorCode: "CONNECTOR_TIMEOUT", retryable: true };
  }
  return { state: "provider_error", errorCode: "UNEXPECTED_CONNECTOR_ERROR", retryable: true };
}

export async function executeConnector(
  connector: FlightConnector,
  intent: SearchIntent,
  requestId: string,
  timeoutMs: number,
  policy: ConnectorExecutionPolicy = {},
): Promise<ConnectorExecution> {
  const maxRetries = Math.max(0, policy.maxRetries ?? 1);
  const cacheTtlMs = Math.max(0, policy.cacheTtlMs ?? 60_000);
  const staleIfErrorMs = Math.max(cacheTtlMs, policy.staleIfErrorMs ?? 300_000);
  const cacheKey = executionCacheKey(connector, intent);
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const cacheEntry = executionCache.get(cacheKey);
  if (cacheEntry && started - cacheEntry.cachedAt <= cacheTtlMs) {
    return cachedExecution(
      cacheEntry,
      started,
      `CACHE_HIT:${started - cacheEntry.cachedAt}ms`,
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("connector_timeout"), timeoutMs);
  let retryCount = 0;

  try {
    const variants = searchVariants(intent);
    const attempts = await Promise.all(
      variants.map((variant, variantIndex) =>
        searchVariant(
          connector,
          variant,
          `${requestId}:date-${variantIndex}`,
          controller.signal,
          maxRetries,
        ),
      ),
    );
    const successful = attempts.flatMap((attempt) =>
      attempt.status === "fulfilled" ? [attempt.value] : [],
    );
    const failed = attempts.filter((attempt) => attempt.status === "rejected");
    retryCount = attempts.reduce((sum, attempt) => sum + attempt.retries, 0);
    if (successful.length === 0 && failed[0]?.status === "rejected") throw failed[0].reason;
    const result: ConnectorSearchResult = {
      offers: successful.flatMap((item) => item.offers),
      ...(successful[0]?.providerRequestId
        ? { providerRequestId: successful[0].providerRequestId }
        : {}),
    };
    const finished = Date.now();
    const probedDates = variants.map((variant) =>
      variant.returnDate
        ? `${variant.departureDate}/${variant.returnDate}`
        : variant.departureDate,
    );
    const execution: ConnectorExecution = {
      result,
      report: {
        connectorId: connector.metadata.id,
        connectorName: connector.metadata.name,
        state: result.offers.length === 0 ? "empty" : "success",
        startedAt,
        finishedAt: new Date(finished).toISOString(),
        durationMs: finished - started,
        offerCount: result.offers.length,
        ...(failed.length > 0 ? { errorCode: "PARTIAL_DATE_PROBE_FAILURE" } : {}),
        retryable: failed.length > 0,
        notes: [
          ...(intent.flexibleDays > 0
            ? [`FLEXIBLE_DATE_THREE_POINT_PROBE:${probedDates.join(",")}`]
            : []),
          ...(failed.length > 0
            ? [`PARTIAL_DATE_PROBE_FAILURE:${failed.length}/${variants.length}`]
            : []),
          ...(retryCount > 0 ? [`RETRY_ATTEMPTS:${retryCount}`] : []),
        ],
      },
    };
    if (cacheTtlMs > 0) {
      executionCache.set(cacheKey, { ...execution, cachedAt: finished });
    }
    return execution;
  } catch (error) {
    const finished = Date.now();
    const classified = controller.signal.aborted
      ? { state: "timeout" as const, errorCode: "CONNECTOR_TIMEOUT", retryable: true }
      : reportState(error);
    if (
      cacheEntry &&
      staleIfErrorMs > 0 &&
      finished - cacheEntry.cachedAt <= staleIfErrorMs
    ) {
      return cachedExecution(
        cacheEntry,
        finished,
        `CACHE_STALE_FALLBACK:${finished - cacheEntry.cachedAt}ms`,
        classified.errorCode,
      );
    }
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
        notes: retryCount > 0 ? [`RETRY_ATTEMPTS:${retryCount}`] : [],
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export type ConnectorRegistryConfig = {
  skyscannerApiKey?: string;
  skyscannerBaseUrl?: string;
  serpApiKey?: string;
  serpApiBaseUrl?: string;
  amadeusClientId?: string;
  amadeusClientSecret?: string;
  amadeusBaseUrl?: string;
  duffelAccessToken?: string;
  duffelBaseUrl?: string;
};

export function createConnectorRegistry(config: ConnectorRegistryConfig): FlightConnector[] {
  const connectors: FlightConnector[] = [];
  if (config.skyscannerApiKey) {
    connectors.push(
      new SkyscannerConnector({
        apiKey: config.skyscannerApiKey,
        baseUrl: config.skyscannerBaseUrl ?? "https://partners.api.skyscanner.net",
      }),
    );
  }
  if (config.serpApiKey) {
    connectors.push(
      new SerpApiGoogleFlightsConnector({
        apiKey: config.serpApiKey,
        baseUrl: config.serpApiBaseUrl ?? "https://serpapi.com",
      }),
    );
  }
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
      resultRole: "verification",
      handoff: "none",
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
      resultRole: "verification",
      handoff: "none",
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

type SerpApiConfig = {
  apiKey: string;
  baseUrl: string;
};

type SerpApiAirport = {
  id?: string;
  name?: string;
  time?: string;
};

type SerpApiFlight = {
  departure_airport?: SerpApiAirport;
  arrival_airport?: SerpApiAirport;
  duration?: number;
  airplane?: string;
  airline?: string;
  flight_number?: string;
  overnight?: boolean;
};

type SerpApiFlightChoice = {
  flights?: SerpApiFlight[];
  total_duration?: number;
  price?: number;
  departure_token?: string;
  booking_token?: string;
};

type SerpApiSearchPayload = {
  error?: string;
  search_metadata?: {
    id?: string;
    status?: string;
    google_flights_url?: string;
  };
  best_flights?: SerpApiFlightChoice[];
  other_flights?: SerpApiFlightChoice[];
};

type SerpApiBookingOption = {
  book_with?: string;
  airline?: boolean;
  price?: number;
  baggage_prices?: string[];
  booking_request?: {
    url?: string;
    post_data?: string;
  };
};

export type SerpApiBookingPayload = {
  error?: string;
  search_metadata?: {
    id?: string;
    status?: string;
    google_flights_url?: string;
  };
  selected_flights?: SerpApiFlightChoice[];
  booking_options?: Array<{
    separate_tickets?: boolean;
    together?: SerpApiBookingOption;
  }>;
};

type CompleteSerpApiChoice = {
  legs: SerpApiFlightChoice[];
  bookingToken: string;
};

export class SerpApiGoogleFlightsConnector implements FlightConnector {
  readonly metadata: ConnectorMetadata;

  constructor(private readonly config: SerpApiConfig) {
    this.metadata = {
      id: "serpapi-google-flights",
      name: "SerpApi · Google Flights",
      kind: "metasearch",
      environment: "production",
      authorization: "contract",
      resultRole: "purchase_handoff",
      handoff: "deep_link",
      configured: true,
    };
  }

  async health(signal: AbortSignal): Promise<ConnectorHealth> {
    try {
      const url = new URL("/account.json", this.config.baseUrl);
      url.searchParams.set("api_key", this.config.apiKey);
      const response = await fetch(url, { signal });
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
    const searchParameters: Record<string, string> = {
      departure_id: intent.origin.code,
      arrival_id: intent.destination.code,
      outbound_date: intent.departureDate,
      ...(intent.returnDate ? { return_date: intent.returnDate } : {}),
      type: intent.tripType === "round_trip" ? "1" : "2",
      adults: String(intent.adults),
      travel_class: "1",
      currency: "CNY",
      gl: "cn",
      hl: "en",
      sort_by: "2",
      stops: intent.directOnly ? "1" : String(Math.min(3, intent.maxStops + 1)),
      deep_search: "true",
      no_cache: "true",
      ...(intent.departureTime?.earliest && intent.departureTime.latest
        ? {
            outbound_times: `${Number(intent.departureTime.earliest.slice(0, 2))},${Number(
              intent.departureTime.latest.slice(0, 2),
            )}`,
          }
        : {}),
    };
    const initial = await this.request(
      searchParameters,
      context.signal,
    ) as SerpApiSearchPayload;

    const initialChoices = flightChoices(initial).slice(0, 4);
    const googleFlightsSearchUrl = safeGoogleFlightsSearchUrl(
      initial.search_metadata?.google_flights_url,
    );
    const complete =
      intent.tripType === "round_trip"
        ? await this.completeRoundTrips(initialChoices, searchParameters, context.signal)
        : initialChoices.flatMap((choice): CompleteSerpApiChoice[] =>
            choice.booking_token && choice.flights?.length
              ? [{ legs: [choice], bookingToken: choice.booking_token }]
              : [],
          );

    const bookingPayloads = await Promise.all(
      complete.slice(0, 6).map(async (choice) => ({
        choice,
        payload: await this.request(
          { ...searchParameters, booking_token: choice.bookingToken },
          context.signal,
        ),
      })),
    );

    const offers = bookingPayloads.flatMap(({ choice, payload }) =>
      mapSerpApiBookingPayload(
        payload as SerpApiBookingPayload,
        choice.legs,
        intent,
        context.requestId,
        googleFlightsSearchUrl,
      ),
    );

    return {
      offers,
      ...(initial.search_metadata?.id
        ? { providerRequestId: initial.search_metadata.id }
        : {}),
    };
  }

  private async completeRoundTrips(
    outboundChoices: SerpApiFlightChoice[],
    searchParameters: Record<string, string>,
    signal: AbortSignal,
  ): Promise<CompleteSerpApiChoice[]> {
    const returningPayloads = await Promise.all(
      outboundChoices.slice(0, 2).flatMap((outbound) =>
        outbound.departure_token && outbound.flights?.length
          ? [
              this.request(
                { ...searchParameters, departure_token: outbound.departure_token },
                signal,
              ).then(
                (payload) => ({ outbound, payload: payload as SerpApiSearchPayload }),
              ),
            ]
          : [],
      ),
    );

    return returningPayloads.flatMap(({ outbound, payload }) =>
      flightChoices(payload)
        .slice(0, 3)
        .flatMap((returning): CompleteSerpApiChoice[] =>
          returning.booking_token && returning.flights?.length && outbound.flights?.length
            ? [{
                legs: [outbound, returning],
                bookingToken: returning.booking_token,
              }]
            : [],
        ),
    );
  }

  private async request(
    parameters: Record<string, string>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const url = new URL("/search.json", this.config.baseUrl);
    url.searchParams.set("engine", "google_flights");
    url.searchParams.set("api_key", this.config.apiKey);
    url.searchParams.set("currency", "CNY");
    url.searchParams.set("gl", "cn");
    url.searchParams.set("hl", "en");
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal,
    });
    if (!response.ok) throw await providerHttpError("SERPAPI", response);
    const payload = await response.json() as { error?: unknown };
    if (typeof payload.error === "string") {
      throw new ConnectorError(payload.error, "SERPAPI_RESPONSE_ERROR", "provider_error", true);
    }
    return payload;
  }
}

function flightChoices(payload: SerpApiSearchPayload): SerpApiFlightChoice[] {
  return [...(payload.best_flights ?? []), ...(payload.other_flights ?? [])];
}

function localSerpApiDateTime(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/.exec(value);
  return match ? `${match[1]}T${match[2]}:00` : undefined;
}

function safePurchaseUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

function safeGoogleFlightsSearchUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "www.google.com" &&
      url.pathname.startsWith("/travel/flights")
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function includedCheckedBaggage(labels: readonly string[]): boolean {
  return labels.some((label) =>
    /(?:free|included).{0,20}checked bag|checked bag.{0,20}(?:free|included)/i.test(label),
  );
}

export function mapSerpApiBookingPayload(
  payload: SerpApiBookingPayload,
  fallbackLegs: SerpApiFlightChoice[],
  intent: SearchIntent,
  requestId: string,
  googleFlightsSearchUrl?: string,
): Offer[] {
  const selectedLegs = payload.selected_flights?.filter(
    (choice) => choice.flights?.length,
  );
  const legChoices = selectedLegs?.length ? selectedLegs : fallbackLegs;
  const flights = legChoices.flatMap((choice) => choice.flights ?? []);
  const legs: Offer["legs"] = [];
  const segments: Offer["segments"] = [];

  for (const [legIndex, choice] of legChoices.entries()) {
    const legFlights = choice.flights ?? [];
    const legSegmentIds: string[] = [];
    for (const [flightIndex, flight] of legFlights.entries()) {
      const departureAt = localSerpApiDateTime(flight.departure_airport?.time);
      const arrivalAt = localSerpApiDateTime(flight.arrival_airport?.time);
      const flightNumber = flight.flight_number?.replace(/\s+/g, "");
      const numberMatch = /^([A-Z0-9]{2,3})([A-Z0-9]+)$/.exec(flightNumber ?? "");
      const marketingCarrier = numberMatch?.[1];
      const marketingFlightNumber = numberMatch?.[2];
      if (
        !departureAt ||
        !arrivalAt ||
        !marketingCarrier ||
        !marketingFlightNumber ||
        typeof flight.departure_airport?.id !== "string" ||
        typeof flight.arrival_airport?.id !== "string" ||
        typeof flight.duration !== "number" ||
        flight.duration <= 0
      ) {
        return [];
      }
      const normalizedSegmentId =
        `${requestId}-${legIndex}-${flightIndex}-${flightNumber}`;
      legSegmentIds.push(normalizedSegmentId);
      const aircraftCode = typeof flight.airplane === "string" ? flight.airplane : undefined;
      segments.push({
        id: normalizedSegmentId,
        legIndex,
        marketingCarrier,
        flightNumber: marketingFlightNumber,
        origin: {
          kind: "airport",
          code: flight.departure_airport.id,
          ...(flight.departure_airport.name
            ? { name: flight.departure_airport.name }
            : {}),
        },
        destination: {
          kind: "airport",
          code: flight.arrival_airport.id,
          ...(flight.arrival_airport.name ? { name: flight.arrival_airport.name } : {}),
        },
        departureAt,
        arrivalAt,
        durationMinutes: flight.duration,
        ...(aircraftCode ? { aircraftCode } : {}),
      });
    }
    const legSegments = segments.filter((segment) => segment.legIndex === legIndex);
    const first = legSegments[0];
    const last = legSegments.at(-1);
    const airborneMinutes = legSegments.reduce(
      (sum, segment) => sum + segment.durationMinutes,
      0,
    );
    if (!first || !last) return [];
    legs.push({
      id: `serpapi:${requestId}:leg-${legIndex}`,
      segmentIds: legSegmentIds,
      origin: first.origin,
      destination: last.destination,
      departureAt: first.departureAt,
      arrivalAt: last.arrivalAt,
      durationMinutes:
        typeof choice.total_duration === "number" &&
        choice.total_duration >= airborneMinutes
          ? choice.total_duration
          : airborneMinutes,
      stopCount: Math.max(0, legSegments.length - 1),
    });
  }

  const hasRedEye = flights.some((flight) => flight.overnight === true);
  return (payload.booking_options ?? []).flatMap((entry, optionIndex): Offer[] => {
    const option = entry.together;
    const exactDeepLink =
      option?.booking_request?.post_data === undefined
        ? safePurchaseUrl(option?.booking_request?.url)
        : undefined;
    const deepLink = exactDeepLink ?? safeGoogleFlightsSearchUrl(googleFlightsSearchUrl);
    if (!option || typeof option.book_with !== "string" || typeof option.price !== "number") {
      return [];
    }

    const baggageLabels = option.baggage_prices ?? [];
    const checkedBaggageIncluded = includedCheckedBaggage(baggageLabels);
    const reasons = [
      ...(deepLink ? [] : ["NO_PURCHASE_HANDOFF"]),
      ...(intent.adults === 1 ? [] : ["MULTI_PASSENGER_PRICE_SCOPE_UNVERIFIED"]),
      ...(intent.minimumCheckedBaggageKg === 0 || checkedBaggageIncluded
        ? []
        : ["CHECKED_BAGGAGE_UNVERIFIED"]),
      ...(intent.avoidRedEye && hasRedEye ? ["RED_EYE_CONFLICT"] : []),
      ...(entry.separate_tickets ? ["SEPARATE_TICKETS"] : []),
      ...(intent.flexibleDays === 0 ? [] : ["FLEXIBLE_DATE_RANGE_NOT_EXPANDED"]),
    ];
    const totalMinor = Math.round(option.price * 100);
    const sourceId = payload.search_metadata?.id ?? requestId;

    return [{
      schemaVersion: "1",
      id: `serpapi:${sourceId}:${optionIndex}:${option.book_with}`,
      sourceOfferId: `${sourceId}:${optionIndex}`,
      connectorId: "serpapi-google-flights",
      environment: "production",
      seller: {
        id: `serpapi-seller:${option.book_with.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name: option.book_with,
        kind: option.airline ? "airline" : "ota",
        ...(deepLink
          ? {
              deepLink,
              handoffPrecision: exactDeepLink ? "exact_offer" as const : "search_results" as const,
            }
          : {}),
      },
      legs,
      segments,
      priceComponents: [{
        kind: "required_service",
        label: "Google Flights 展示总价（供应方未拆分）",
        amountMinor: totalMinor,
        currency: "CNY",
        required: true,
      }],
      totalPrice: { amountMinor: totalMinor, currency: "CNY" },
      totalPriceCny: { amountMinor: totalMinor, currency: "CNY" },
      baggage: checkedBaggageIncluded
        ? [{ type: "checked", included: true }]
        : [],
      refundable: null,
      changeable: null,
      eligibility: entry.separate_tickets ? ["SEPARATE_TICKETS"] : [],
      fetchedAt: new Date().toISOString(),
      evidenceRef: sourceId,
      comparable: reasons.length === 0,
      incomparabilityReasons: reasons,
      qualityScore: reasons.length === 0 ? 82 : 55,
    }];
  });
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

  const legs: Offer["legs"] = [];
  const segments: Offer["segments"] = [];
  for (const [legIndex, itineraryValue] of itineraries.entries()) {
    if (!itineraryValue || typeof itineraryValue !== "object") return [];
    const itinerary = itineraryValue as Record<string, unknown>;
    const rawSegments = Array.isArray(itinerary.segments) ? itinerary.segments : [];
    const legSegmentIds: string[] = [];
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
      legSegmentIds.push(segment.id);
      segments.push({
        id: segment.id,
        legIndex,
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
    const legSegments = segments.filter((segment) => segment.legIndex === legIndex);
    const first = legSegments[0];
    const last = legSegments.at(-1);
    const airborneMinutes = legSegments.reduce(
      (sum, segment) => sum + segment.durationMinutes,
      0,
    );
    const providerDuration = durationMinutes(itinerary.duration);
    if (!first || !last) return [];
    legs.push({
      id: `amadeus:${requestId}:leg-${legIndex}`,
      segmentIds: legSegmentIds,
      origin: first.origin,
      destination: last.destination,
      departureAt: first.departureAt,
      arrivalAt: last.arrivalAt,
      durationMinutes:
        providerDuration && providerDuration >= airborneMinutes
          ? providerDuration
          : airborneMinutes,
      stopCount: Math.max(0, legSegments.length - 1),
    });
  }

  const id = typeof item.id === "string" ? item.id : `${requestId}-${segments[0]?.id ?? "offer"}`;
  const tax = Math.max(0, total - base);
  return [{
    schemaVersion: "1",
    id: `amadeus:${requestId}:${id}`,
    sourceOfferId: id,
    connectorId: "amadeus-self-service",
    environment,
    seller: { id: "amadeus", name: "Amadeus", kind: "aggregator" },
    legs,
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
    comparable: false,
    incomparabilityReasons: [
      "NO_PURCHASE_HANDOFF",
      ...(currency === "CNY" ? [] : ["FX_RATE_REQUIRED"]),
    ],
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
  const legs: Offer["legs"] = [];
  const segments: Offer["segments"] = [];

  for (const [legIndex, sliceValue] of slices.entries()) {
    if (!sliceValue || typeof sliceValue !== "object") return [];
    const slice = sliceValue as Record<string, unknown>;
    const legSegmentIds: string[] = [];
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
      legSegmentIds.push(segment.id);
      segments.push({
        id: segment.id,
        legIndex,
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
    const legSegments = segments.filter((segment) => segment.legIndex === legIndex);
    const first = legSegments[0];
    const last = legSegments.at(-1);
    const airborneMinutes = legSegments.reduce(
      (sum, segment) => sum + segment.durationMinutes,
      0,
    );
    const providerDuration = durationMinutes(slice.duration);
    if (!first || !last) return [];
    legs.push({
      id: `duffel:${requestId}:leg-${legIndex}`,
      segmentIds: legSegmentIds,
      origin: first.origin,
      destination: last.destination,
      departureAt: first.departureAt,
      arrivalAt: last.arrivalAt,
      durationMinutes:
        providerDuration && providerDuration >= airborneMinutes
          ? providerDuration
          : airborneMinutes,
      stopCount: Math.max(0, legSegments.length - 1),
    });
  }

  const id = typeof item.id === "string" ? item.id : `${requestId}-${segments[0]?.id ?? "offer"}`;
  const owner = item.owner as Record<string, unknown> | undefined;
  return [{
    schemaVersion: "1",
    id: `duffel:${requestId}:${id}`,
    sourceOfferId: id,
    connectorId: "duffel-flights",
    environment,
    seller: {
      id: typeof owner?.id === "string" ? owner.id : "duffel",
      name: typeof owner?.name === "string" ? owner.name : "Duffel",
      kind: typeof owner?.name === "string" ? "airline" : "aggregator",
    },
    legs,
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
    comparable: false,
    incomparabilityReasons: [
      "NO_PURCHASE_HANDOFF",
      ...(currency === "CNY" ? [] : ["FX_RATE_REQUIRED"]),
    ],
    qualityScore: 78,
  }];
}
