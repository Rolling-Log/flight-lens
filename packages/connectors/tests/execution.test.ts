import assert from "node:assert/strict";
import test from "node:test";
import type { SearchIntent } from "@flight-lens/contracts";
import {
  clearConnectorExecutionCache,
  ConnectorError,
  executeConnector,
  mapSerpApiBookingPayload,
  mapSkyscannerSearchResults,
  SerpApiGoogleFlightsConnector,
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
        flight_number: "CA 8357",
        airline: "Air China",
      }],
    }],
    intent,
    "request-1",
  );

  assert.equal(offers.length, 1);
  assert.equal(offers[0]?.seller.name, "Example Airline");
  assert.equal(offers[0]?.totalPrice.amountMinor, 120000);
  assert.equal(offers[0]?.comparable, true);
  assert.equal(offers[0]?.segments[0]?.marketingCarrier, "CA");
  assert.equal(offers[0]?.segments[0]?.flightNumber, "8357");
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
    if (url.pathname === "/account.json") {
      return new Response(JSON.stringify({
        account_status: "Active",
        plan_monthly_price: 0,
        plan_searches_left: 250,
        total_searches_left: 250,
      }), { status: 200 });
    }
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
  const initialRequest = requestedUrls.find((url) =>
    url.pathname === "/search.json" &&
    !url.searchParams.has("booking_token") &&
    !url.searchParams.has("departure_token")
  );
  assert.equal(bookingRequest?.searchParams.get("departure_id"), "PVG");
  assert.equal(bookingRequest?.searchParams.get("arrival_id"), "NRT");
  assert.equal(bookingRequest?.searchParams.get("outbound_date"), "2026-08-24");
  assert.equal(initialRequest?.searchParams.get("deep_search"), null);
  assert.equal(initialRequest?.searchParams.get("no_cache"), "true");
  assert.equal(result.offers.length, 1);
});

test("refuses SerpApi paid plans before consuming a search credit", async (t) => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: URL[] = [];
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
    return new Response(JSON.stringify({
      account_status: "Active",
      plan_monthly_price: 25,
      plan_searches_left: 1_000,
    }), { status: 200 });
  };

  const connector = new SerpApiGoogleFlightsConnector({
    apiKey: "test",
    baseUrl: "https://serpapi.test",
  });

  await assert.rejects(
    connector.search(intent, {
      requestId: "request-paid-plan",
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      error instanceof ConnectorError && error.code === "SERPAPI_NON_FREE_PLAN",
  );
  assert.deepEqual(requestedUrls.map((url) => url.pathname), ["/account.json"]);
});

test("refuses a SerpApi search that could exceed the remaining free quota", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response(JSON.stringify({
      account_status: "Active",
      plan_monthly_price: 0,
      total_searches_left: 4,
    }), { status: 200 });

  const connector = new SerpApiGoogleFlightsConnector({
    apiKey: "test",
    baseUrl: "https://serpapi.test",
  });

  await assert.rejects(
    connector.search(intent, {
      requestId: "request-low-quota",
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      error instanceof ConnectorError && error.code === "SERPAPI_FREE_QUOTA_LOW",
  );
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
