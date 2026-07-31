import assert from "node:assert/strict";
import test from "node:test";
import type { SearchIntent } from "@flight-lens/contracts";
import {
  clearConnectorExecutionCache,
  ConnectorError,
  executeConnector,
  mapSerpApiBookingPayload,
  mapSkyscannerSearchResults,
  mapWegoSearchResults,
  SerpApiGoogleFlightsConnector,
  WegoConnector,
  type FlightConnector,
} from "../src/index.js";

const intent: SearchIntent = {
  schemaVersion: "1",
  tripType: "one_way",
  origin: { kind: "airport", code: "PVG" },
  destination: { kind: "airport", code: "NRT" },
  departureDate: "2026-08-24",
  flexibleDays: 0,
  adults: 1,
  cabin: "economy",
  directOnly: false,
  maxStops: 1,
  avoidRedEye: false,
  minimumCheckedBaggageKg: 0,
  includeNearbyAirports: false,
  explicitFields: [],
  inferredFields: [],
  pendingQuestions: [],
};

test("classifies an empty successful source distinctly from failure", async () => {
  const connector: FlightConnector = {
    metadata: {
      id: "empty",
      name: "Empty",
      kind: "aggregator",
      environment: "sandbox",
      authorization: "self_service_api",
      resultRole: "verification",
      handoff: "none",
      configured: true,
    },
    health: async () => ({ state: "healthy", checkedAt: new Date().toISOString() }),
    search: async () => ({ offers: [] }),
  };
  const execution = await executeConnector(connector, intent, crypto.randomUUID(), 100);
  assert.equal(execution.report.state, "empty");
});

test("runs a disclosed three-point probe for a limited flexible-date search", async () => {
  const searchedDates: string[] = [];
  const connector: FlightConnector = {
    metadata: {
      id: "date-probe",
      name: "Date probe",
      kind: "metasearch",
      environment: "production",
      authorization: "partner_api",
      resultRole: "purchase_handoff",
      handoff: "deep_link",
      configured: true,
    },
    health: async () => ({ state: "healthy", checkedAt: new Date().toISOString() }),
    search: async (candidate) => {
      searchedDates.push(candidate.departureDate);
      return { offers: [] };
    },
  };
  const execution = await executeConnector(
    connector,
    { ...intent, flexibleDays: 3 },
    crypto.randomUUID(),
    100,
  );

  assert.deepEqual(searchedDates.sort(), ["2026-08-21", "2026-08-24", "2026-08-27"]);
  assert.equal(
    execution.report.notes.some((note) =>
      note.startsWith("FLEXIBLE_DATE_THREE_POINT_PROBE:")),
    true,
  );
});

test("keeps a rate-sensitive connector to one baseline-date search", async () => {
  const searchedDates: string[] = [];
  const connector: FlightConnector = {
    metadata: {
      id: "rate-sensitive",
      name: "Rate sensitive",
      kind: "metasearch",
      environment: "production",
      authorization: "partner_api",
      resultRole: "purchase_handoff",
      handoff: "deep_link",
      configured: true,
      supportsFlexibleDateProbe: false,
    },
    health: async () => ({ state: "healthy", checkedAt: new Date().toISOString() }),
    search: async (candidate) => {
      searchedDates.push(candidate.departureDate);
      return { offers: [] };
    },
  };
  const execution = await executeConnector(
    connector,
    { ...intent, flexibleDays: 3 },
    crypto.randomUUID(),
    100,
  );

  assert.deepEqual(searchedDates, ["2026-08-24"]);
  assert.equal(
    execution.report.notes.includes(
      "FLEXIBLE_DATE_PROBE_UNSUPPORTED:rate-sensitive",
    ),
    true,
  );
});

test("maps a SerpApi booking option only when it has a consumer handoff", () => {
  const offers = mapSerpApiBookingPayload(
    {
      search_metadata: { id: "search-1", status: "Success" },
      booking_options: [{
        together: {
          book_with: "Example Airline",
          airline: true,
          price: 1200,
          booking_request: { url: "https://www.google.com/travel/clk/f?test=1" },
        },
      }],
    },
    [{
      total_duration: 180,
      flights: [{
        departure_airport: { id: "PVG", name: "Shanghai Pudong", time: "2026-08-24 09:00" },
        arrival_airport: { id: "NRT", name: "Narita", time: "2026-08-24 13:00" },
        duration: 180,
        flight_number: "MU 523",
        airline: "China Eastern",
      }],
    }],
    intent,
    "request-1",
  );

  assert.equal(offers.length, 1);
  assert.equal(offers[0]?.seller.name, "Example Airline");
  assert.equal(offers[0]?.totalPrice.amountMinor, 120000);
  assert.equal(offers[0]?.comparable, true);
});

test("keeps POST-only SerpApi handoffs out of comparable results", () => {
  const offers = mapSerpApiBookingPayload(
    {
      booking_options: [{
        together: {
          book_with: "Example OTA",
          price: 900,
          booking_request: {
            url: "https://www.google.com/travel/clk/f",
            post_data: "opaque=1",
          },
        },
      }],
    },
    [{
      total_duration: 180,
      flights: [{
        departure_airport: { id: "PVG", time: "2026-08-24 09:00" },
        arrival_airport: { id: "NRT", time: "2026-08-24 13:00" },
        duration: 180,
        flight_number: "MU 523",
      }],
    }],
    intent,
    "request-2",
  );

  assert.equal(offers[0]?.comparable, false);
  assert.equal(offers[0]?.incomparabilityReasons.includes("NO_PURCHASE_HANDOFF"), true);
});

test("uses the canonical Google Flights result page without pretending it is exact", () => {
  const offers = mapSerpApiBookingPayload(
    {
      booking_options: [{
        together: {
          book_with: "Example OTA",
          price: 900,
          booking_request: {
            url: "https://www.google.com/travel/clk/f",
            post_data: "opaque=1",
          },
        },
      }],
    },
    [{
      total_duration: 180,
      flights: [{
        departure_airport: { id: "PVG", time: "2026-08-24 09:00" },
        arrival_airport: { id: "NRT", time: "2026-08-24 13:00" },
        duration: 180,
        flight_number: "MU 523",
      }],
    }],
    intent,
    "request-search-results",
    "https://www.google.com/travel/flights?hl=en&curr=CNY&tfs=opaque",
  );

  assert.equal(offers[0]?.comparable, true);
  assert.equal(offers[0]?.seller.handoffPrecision, "search_results");
  assert.equal(
    offers[0]?.seller.deepLink,
    "https://www.google.com/travel/flights?hl=en&curr=CNY&tfs=opaque",
  );
});

test("forwards the original search parameters when resolving SerpApi booking options", async (t) => {
  const requestedUrls: URL[] = [];
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    requestedUrls.push(url);
    if (url.searchParams.has("booking_token")) {
      return new Response(JSON.stringify({
        selected_flights: [{
          total_duration: 180,
          flights: [{
            departure_airport: { id: "PVG", time: "2026-08-24 09:00" },
            arrival_airport: { id: "NRT", time: "2026-08-24 13:00" },
            duration: 180,
            flight_number: "MU 523",
          }],
        }],
        booking_options: [{
          together: {
            book_with: "Example Airline",
            airline: true,
            price: 1200,
            booking_request: {
              url: "https://www.google.com/travel/clk/f?opaque=1",
            },
          },
        }],
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      search_metadata: {
        id: "search-1",
        google_flights_url:
          "https://www.google.com/travel/flights?hl=en&curr=CNY&tfs=opaque",
      },
      best_flights: [{
        booking_token: "booking-1",
        total_duration: 180,
        flights: [{
          departure_airport: { id: "PVG", time: "2026-08-24 09:00" },
          arrival_airport: { id: "NRT", time: "2026-08-24 13:00" },
          duration: 180,
          flight_number: "MU 523",
        }],
      }],
    }), { status: 200 });
  };

  const connector = new SerpApiGoogleFlightsConnector({
    apiKey: "test",
    baseUrl: "https://serpapi.test",
  });
  const result = await connector.search(intent, {
    requestId: "request-chain",
    signal: new AbortController().signal,
  });

  const bookingRequest = requestedUrls.find((url) => url.searchParams.has("booking_token"));
  assert.equal(bookingRequest?.searchParams.get("departure_id"), "PVG");
  assert.equal(bookingRequest?.searchParams.get("arrival_id"), "NRT");
  assert.equal(bookingRequest?.searchParams.get("outbound_date"), "2026-08-24");
  assert.equal(result.offers.length, 1);
});

test("retries one transient provider error and discloses the retry", async () => {
  clearConnectorExecutionCache();
  let calls = 0;
  const connector: FlightConnector = {
    metadata: {
      id: "retry-once",
      name: "Retry once",
      kind: "aggregator",
      environment: "sandbox",
      authorization: "self_service_api",
      resultRole: "verification",
      handoff: "none",
      configured: true,
    },
    health: async () => ({ state: "healthy", checkedAt: new Date().toISOString() }),
    search: async () => {
      calls += 1;
      if (calls === 1) {
        throw new ConnectorError(
          "Temporary provider error",
          "TEMPORARY_PROVIDER_ERROR",
          "provider_error",
          true,
        );
      }
      return { offers: [] };
    },
  };

  const execution = await executeConnector(
    connector,
    intent,
    crypto.randomUUID(),
    1_000,
    { maxRetries: 1, cacheTtlMs: 0 },
  );
  assert.equal(calls, 2);
  assert.equal(execution.report.state, "empty");
  assert.equal(execution.report.notes.includes("RETRY_ATTEMPTS:1"), true);
});

test("serves a fresh cache hit with an explicit freshness note", async () => {
  clearConnectorExecutionCache();
  let calls = 0;
  const connector: FlightConnector = {
    metadata: {
      id: "cache-hit",
      name: "Cache hit",
      kind: "aggregator",
      environment: "sandbox",
      authorization: "self_service_api",
      resultRole: "verification",
      handoff: "none",
      configured: true,
    },
    health: async () => ({ state: "healthy", checkedAt: new Date().toISOString() }),
    search: async () => {
      calls += 1;
      return { offers: [] };
    },
  };

  await executeConnector(connector, intent, crypto.randomUUID(), 1_000, {
    cacheTtlMs: 60_000,
  });
  const cached = await executeConnector(connector, intent, crypto.randomUUID(), 1_000, {
    cacheTtlMs: 60_000,
  });

  assert.equal(calls, 1);
  assert.equal(cached.report.notes.some((note) => note.startsWith("CACHE_HIT:")), true);
});

test("falls back to a disclosed stale cache entry after a provider failure", async () => {
  clearConnectorExecutionCache();
  let fail = false;
  const connector: FlightConnector = {
    metadata: {
      id: "stale-fallback",
      name: "Stale fallback",
      kind: "aggregator",
      environment: "sandbox",
      authorization: "self_service_api",
      resultRole: "verification",
      handoff: "none",
      configured: true,
    },
    health: async () => ({ state: "healthy", checkedAt: new Date().toISOString() }),
    search: async () => {
      if (fail) {
        throw new ConnectorError(
          "Provider unavailable",
          "PROVIDER_UNAVAILABLE",
          "provider_error",
          true,
        );
      }
      return { offers: [] };
    },
  };

  await executeConnector(connector, intent, crypto.randomUUID(), 1_000, {
    maxRetries: 0,
    cacheTtlMs: 1,
    staleIfErrorMs: 1_000,
  });
  fail = true;
  await new Promise((resolve) => setTimeout(resolve, 5));
  const fallback = await executeConnector(connector, intent, crypto.randomUUID(), 1_000, {
    maxRetries: 0,
    cacheTtlMs: 1,
    staleIfErrorMs: 1_000,
  });

  assert.equal(fallback.report.state, "empty");
  assert.equal(fallback.report.errorCode, "PROVIDER_UNAVAILABLE");
  assert.equal(
    fallback.report.notes.some((note) => note.startsWith("CACHE_STALE_FALLBACK:")),
    true,
  );
});

test("maps an exact Skyscanner agent deeplink and integer price unit", () => {
  const offers = mapSkyscannerSearchResults(
    {
      itineraries: {
        itinerary1: {
          legIds: ["leg1"],
          pricingOptions: [{
            id: "price1",
            price: { amount: "123456", unit: "PRICE_UNIT_CENTI" },
            agentIds: ["agent1"],
            items: [{
              agentId: "agent1",
              deepLink: "https://agw.skyscnr.com/v1/redirect?opaque=1%2B2",
            }],
            transferType: "TRANSFER_TYPE_MANAGED",
          }],
        },
      },
      legs: {
        leg1: {
          segmentIds: ["segment1"],
          stopCount: 0,
          durationInMinutes: 180,
        },
      },
      segments: {
        segment1: {
          originPlaceId: "place1",
          destinationPlaceId: "place2",
          departureDateTime: {
            year: 2026,
            month: 8,
            day: 24,
            hour: 9,
            minute: 0,
          },
          arrivalDateTime: {
            year: 2026,
            month: 8,
            day: 24,
            hour: 13,
            minute: 0,
          },
          durationInMinutes: 180,
          marketingFlightNumber: "523",
          marketingCarrierId: "carrier1",
        },
      },
      places: {
        place1: { name: "Shanghai Pudong", iata: "PVG" },
        place2: { name: "Narita", iata: "NRT" },
      },
      carriers: {
        carrier1: { name: "China Eastern", displayCode: "MU" },
      },
      agents: {
        agent1: { name: "Example Airline", type: "AGENT_TYPE_AIRLINE" },
      },
    },
    intent,
    "request-skyscanner-1",
  );

  assert.equal(offers.length, 1);
  assert.equal(offers[0]?.seller.name, "Example Airline");
  assert.equal(
    offers[0]?.seller.deepLink,
    "https://agw.skyscnr.com/v1/redirect?opaque=1%2B2",
  );
  assert.equal(offers[0]?.totalPrice.amountMinor, 123456);
  assert.equal(offers[0]?.comparable, true);
});

test("keeps Skyscanner multi-ticket handoffs out of comparable results", () => {
  const offers = mapSkyscannerSearchResults(
    {
      itineraries: {
        itinerary1: {
          legIds: ["leg1"],
          pricingOptions: [{
            price: { amount: "90000", unit: "PRICE_UNIT_CENTI" },
            items: [
              { agentId: "agent1", deepLink: "https://example.com/outbound" },
              { agentId: "agent2", deepLink: "https://example.com/inbound" },
            ],
          }],
        },
      },
      legs: { leg1: { segmentIds: ["segment1"], stopCount: 0 } },
      segments: {
        segment1: {
          originPlaceId: "place1",
          destinationPlaceId: "place2",
          departureDateTime: {
            year: 2026,
            month: 8,
            day: 24,
            hour: 9,
            minute: 0,
          },
          arrivalDateTime: {
            year: 2026,
            month: 8,
            day: 24,
            hour: 13,
            minute: 0,
          },
          durationInMinutes: 180,
          marketingFlightNumber: "523",
          marketingCarrierId: "carrier1",
        },
      },
      places: {
        place1: { iata: "PVG" },
        place2: { iata: "NRT" },
      },
      carriers: {
        carrier1: { displayCode: "MU" },
      },
      agents: {
        agent1: { name: "Outbound seller", type: "AGENT_TYPE_AIRLINE" },
        agent2: { name: "Inbound seller", type: "AGENT_TYPE_AIRLINE" },
      },
    },
    intent,
    "request-skyscanner-2",
  );

  assert.equal(offers[0]?.comparable, false);
  assert.equal(
    offers[0]?.incomparabilityReasons.includes("MULTIPLE_PURCHASE_HANDOFFS"),
    true,
  );
});

test("maps a Wego fare only with its official handoff and actual seller", () => {
  const offers = mapWegoSearchResults(
    {
      search: { id: "wego-search-1" },
      airports: [
        { code: "PVG", name: "上海浦东国际机场" },
        { code: "NRT", name: "东京成田国际机场" },
      ],
      providers: [{ code: "example-airline", name: "示例航空", type: "airline" }],
      legs: [{
        id: "leg-1",
        departureDateTime: "2026-08-24T09:00:00.000+08:00",
        arrivalDateTime: "2026-08-24T13:00:00.000+09:00",
        durationMinutes: 180,
        segments: [{
          departureAirportCode: "PVG",
          arrivalAirportCode: "NRT",
          durationMinutes: 180,
          airlineCode: "MU",
          operatingAirlineCode: "MU",
          designatorCode: "MU523",
          departureDateTime: "2026-08-24T09:00:00.000+08:00",
          arrivalDateTime: "2026-08-24T13:00:00.000+09:00",
        }],
      }],
      trips: [{ id: "trip-1", legIds: ["leg-1"] }],
      fares: [{
        id: "fare-1",
        tripId: "trip-1",
        providerCode: "example-airline",
        handoffUrl:
          "https://handoff.wego.com/flights/continue?fare_id=fare-1&search_id=wego-search-1",
        price: { totalAmount: 1402, currencyCode: "CNY" },
        refundable: false,
        exchangeable: true,
      }],
    },
    "request-wego-1",
  );

  assert.equal(offers.length, 1);
  assert.equal(offers[0]?.seller.name, "示例航空");
  assert.equal(offers[0]?.seller.kind, "airline");
  assert.equal(offers[0]?.totalPrice.amountMinor, 140200);
  assert.equal(offers[0]?.seller.handoffPrecision, "exact_offer");
  assert.equal(offers[0]?.comparable, true);
});

test("rejects a non-Wego redirect from Wego comparable results", () => {
  const offers = mapWegoSearchResults(
    {
      providers: [{ code: "example-ota", name: "示例票代", type: "ota" }],
      legs: [{
        id: "leg-1",
        durationMinutes: 180,
        segments: [{
          departureAirportCode: "PVG",
          arrivalAirportCode: "NRT",
          durationMinutes: 180,
          airlineCode: "MU",
          designatorCode: "MU523",
          departureDateTime: "2026-08-24T09:00:00+08:00",
          arrivalDateTime: "2026-08-24T13:00:00+09:00",
        }],
      }],
      trips: [{ id: "trip-1", legIds: ["leg-1"] }],
      fares: [{
        id: "fare-evil",
        tripId: "trip-1",
        providerCode: "example-ota",
        handoffUrl: "https://evil.example/continue",
        price: { totalAmount: 999, currencyCode: "CNY" },
      }],
    },
    "request-wego-evil",
  );

  assert.equal(offers[0]?.comparable, false);
  assert.equal(
    offers[0]?.incomparabilityReasons.includes("NO_PURCHASE_HANDOFF"),
    true,
  );
});

test("runs Wego token, start, and stable-count polling as one user search", async (t) => {
  const originalFetch = globalThis.fetch;
  const requested: Array<{ url: URL; method: string; body?: unknown }> = [];
  let resultPolls = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string"
        ? JSON.parse(init.body) as unknown
        : undefined;
    requested.push({ url, method, ...(body ? { body } : {}) });
    if (url.pathname === "/apps/oauth/token") {
      return new Response(JSON.stringify({
        access_token: "wego-token",
        expires_in: 43_200,
      }), { status: 200 });
    }
    if (url.pathname === "/metasearch/flights/searches" && method === "POST") {
      return new Response(JSON.stringify({
        search: { id: "wego-search-2" },
      }), { status: 200 });
    }
    resultPolls += 1;
    if (resultPolls === 1) {
      return new Response(JSON.stringify({
        count: 0,
        providers: [{ code: "example-ota", name: "示例票代", type: "ota" }],
        legs: [{
          id: "leg-1",
          durationMinutes: 180,
          segments: [{
            departureAirportCode: "PVG",
            arrivalAirportCode: "NRT",
            durationMinutes: 180,
            airlineCode: "MU",
            designatorCode: "MU523",
            departureDateTime: "2026-08-24T09:00:00+08:00",
            arrivalDateTime: "2026-08-24T13:00:00+09:00",
          }],
        }],
        trips: [{ id: "trip-1", legIds: ["leg-1"] }],
      }), { status: 200 });
    }
    if (resultPolls === 2) {
      return new Response(JSON.stringify({
        count: 1,
        fares: [{
          id: "fare-1",
          tripId: "trip-1",
          providerCode: "example-ota",
          handoffUrl:
            "https://handoff.wego.com/flights/continue?fare_id=fare-1&search_id=wego-search-2",
          price: { totalAmount: 1402, currencyCode: "CNY" },
        }],
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ count: 1 }), { status: 200 });
  };

  const connector = new WegoConnector({
    clientId: "wego-client",
    baseUrl: "https://wego.test",
    pollDelaysMs: [0, 0, 0, 0],
  });
  const result = await connector.search(intent, {
    requestId: "request-wego-flow",
    signal: new AbortController().signal,
  });
  const start = requested.find(
    (request) =>
      request.url.pathname === "/metasearch/flights/searches" &&
      request.method === "POST",
  );
  const search = (start?.body as {
    search?: { currencyCode?: string; siteCode?: string; legs?: unknown[] };
  })?.search;

  assert.equal(search?.currencyCode, "CNY");
  assert.equal(search?.siteCode, "CN");
  assert.equal(search?.legs?.length, 1);
  assert.equal(
    requested.filter((request) => request.url.pathname.endsWith("/results")).length,
    4,
  );
  assert.equal(result.providerRequestId, "wego-search-2");
  assert.equal(result.offers[0]?.comparable, true);
});
