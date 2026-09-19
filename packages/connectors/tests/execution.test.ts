import assert from "node:assert/strict";
import test from "node:test";
import type { SearchIntent } from "@flight-lens/contracts";
import {
  AmadeusConnector,
  amadeusEnvironment,
  clearConnectorExecutionCache,
  combineSplitTicketOffers,
  CompanionOtaConnector,
  connectorApplicability,
  createConnectorRegistry,
  ConnectorError,
  DuffelConnector,
  duffelEnvironment,
  executeConnector,
  FlightApiConnector,
  mapCtripBatchSearchPayload,
  mapDomCards,
  mapFlyAiFlightPayload,
  mapAmadeusOffer,
  mapDuffelOffer,
  mapFlightApiSearchPayload,
  mapSerpApiBookingPayload,
  mapSerpApiPriceInsights,
  mapSerpApiSearchChoices,
  mapSkyscannerSearchResults,
  serpApiOriginSelection,
  serpApiRequiredCredits,
  SerpApiGoogleFlightsConnector,
  type FlightConnector,
  withCompanionConnectors,
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

test("maps SerpApi price insights without issuing a second search", () => {
  const insight = mapSerpApiPriceInsights({
    search_parameters: { currency: "CNY" },
    price_insights: {
      lowest_price: 880,
      price_level: "low",
      typical_price_range: [1_000, 1_400],
      price_history: [
        [1_780_704_000, 1_200],
        [1_780_790_400, 1_100],
      ],
    },
  }, intent, "2026-08-12T12:00:00.000Z");

  assert.equal(insight?.lowestPriceMinor, 88_000);
  assert.deepEqual(insight?.typicalPriceRangeMinor, [100_000, 140_000]);
  assert.equal(insight?.history.length, 2);
  assert.equal(insight?.currency, "CNY");
  assert.equal(insight?.priceBasis, "listed_only");
  assert.deepEqual({
    origin: insight?.originCode,
    destination: insight?.destinationCode,
    departureDate: insight?.departureDate,
    returnDate: insight?.returnDate,
  }, { origin: "PVG", destination: "NRT", departureDate: "2026-08-24", returnDate: null });
});

test("rejects malformed or non-CNY SerpApi price insights", () => {
  assert.equal(mapSerpApiPriceInsights({
    search_parameters: { currency: "USD" },
    price_insights: { lowest_price: 500 },
  }, intent), undefined);
  assert.equal(mapSerpApiPriceInsights({
    search_parameters: { currency: "CNY" },
    price_insights: { lowest_price: "500", typical_price_range: [1_000] },
  }, intent), undefined);
});

const amadeusOffer = {
  id: "amadeus-offer-1",
  price: { grandTotal: "1200.00", base: "1000.00", currency: "CNY" },
  itineraries: [{
    duration: "PT3H",
    segments: [{
      id: "amadeus-segment-1",
      carrierCode: "MU",
      number: "523",
      departure: { iataCode: "PVG", at: "2026-08-24T09:00:00+08:00" },
      arrival: { iataCode: "NRT", at: "2026-08-24T13:00:00+09:00" },
      duration: "PT3H",
      aircraft: { code: "320" },
    }],
  }],
};

const duffelOffer = {
  id: "duffel-offer-1",
  total_amount: "900.00",
  base_amount: "700.00",
  tax_amount: "200.00",
  total_currency: "CNY",
  expires_at: "2026-08-20T00:00:00.000Z",
  owner: { id: "airline-mu", name: "Example Airline" },
  slices: [{
    duration: "PT3H",
    segments: [{
      id: "duffel-segment-1",
      marketing_carrier_flight_number: "523",
      origin: { iata_code: "PVG" },
      destination: { iata_code: "NRT" },
      departing_at: "2026-08-24T09:00:00+08:00",
      arriving_at: "2026-08-24T13:00:00+09:00",
      marketing_carrier: { iata_code: "MU" },
      operating_carrier: { iata_code: "MU" },
      duration: "PT3H",
    }],
  }],
};

const flightApiPayload = {
  itineraries: [{
    id: "itinerary-1",
    leg_ids: ["leg-1"],
    pricing_options: [{
      id: "price-1",
      price: { amount: 1234.56, update_status: "current" },
      transfer_type: "MANAGED",
      items: [{
        agent_id: "trip",
        url: "/transport_deeplink/4.0/CN/zh-CN/CNY/trip/1/flight",
      }],
    }],
  }],
  legs: [{
    id: "leg-1",
    segment_ids: ["segment-1"],
    duration: 180,
    stop_count: 0,
  }],
  segments: [{
    id: "segment-1",
    origin_place_id: 1,
    destination_place_id: 2,
    departure: "2026-08-24T09:00:00",
    arrival: "2026-08-24T13:00:00",
    duration: 180,
    marketing_flight_number: "523",
    marketing_carrier_id: -1,
    operating_carrier_id: -1,
  }],
  places: [
    { id: 1, iata: "PVG", name: "Shanghai Pudong" },
    { id: 2, iata: "NRT", name: "Tokyo Narita" },
  ],
  carriers: [{ id: -1, iata: "MU", name: "China Eastern" }],
  agents: [{ id: "trip", name: "Trip.com", type: "ota" }],
};

test("maps FlightAPI prices with an explicit Skyscanner-derived handoff", () => {
  const offers = mapFlightApiSearchPayload(flightApiPayload, intent, "request-flightapi");

  assert.equal(offers.length, 1);
  assert.equal(offers[0]?.connectorId, "flightapi-skyscanner");
  assert.equal(offers[0]?.totalPrice.amountMinor, 123_456);
  assert.equal(offers[0]?.seller.name, "Trip.com");
  assert.equal(
    offers[0]?.seller.deepLink,
    "https://www.skyscanner.com/transport_deeplink/4.0/CN/zh-CN/CNY/trip/1/flight",
  );
  assert.deepEqual(offers[0]?.eligibility, ["SKYSCANNER_DERIVED_SOURCE"]);
  assert.equal(offers[0]?.comparable, true);
});

test("maps FlyAI flight items into a real Fliggy handoff with adult total price", () => {
  const offers = mapFlyAiFlightPayload({
    status: 0,
    data: {
      itemList: [{
        ticketPrice: "¥400.0",
        jumpUrl: "https://market.m.taobao.com/app/trip/flight/index.html",
        journeys: [{
          totalDuration: "140",
          segments: [{
            depStationCode: "PEK",
            depStationName: "北京首都",
            depDateTime: "2026-09-10 08:00:00",
            arrStationCode: "SHA",
            arrStationName: "上海虹桥",
            arrDateTime: "2026-09-10 10:20:00",
            duration: "140",
            marketingTransportNo: "CA1883",
            seatClassName: "经济舱",
          }],
        }],
      }],
    },
  }, { ...intent, origin: { kind: "airport", code: "PEK" }, destination: { kind: "airport", code: "SHA" }, adults: 2 }, "flyai-request");

  assert.equal(offers.length, 1);
  assert.equal(offers[0]?.seller.name, "飞猪");
  assert.equal(offers[0]?.totalPrice.amountMinor, 80_000);
  assert.equal(offers[0]?.priceVerificationStatus, "listed_only");
  assert.equal(offers[0]?.comparable, false);
  assert.ok(offers[0]?.incomparabilityReasons.includes("PRICE_TAX_UNVERIFIED"));
  assert.ok(offers[0]?.incomparabilityReasons.includes("SELLER_LIST_INCOMPLETE"));
  assert.equal(offers[0]?.segments[0]?.flightNumber, "1883");
});

test("maps visible airport names to canonical IATA and rejects an airport mismatch", () => {
  const offers = mapDomCards([{
    cardText: "东方航空 MU5231 22:00 北京大兴机场 00:05 浦东机场 T1 ¥350",
    flightNumberText: "MU5231",
    airlineName: "东方航空",
    departureTime: "22:00",
    arrivalTime: "00:05",
    departureAirport: "北京大兴机场",
    arrivalAirport: "浦东机场 T1",
    priceText: "¥350",
    evidenceKind: "dom",
  }], "qunar", {
    ...intent,
    origin: { kind: "airport", code: "PEK" },
    destination: { kind: "airport", code: "SHA" },
    departureDate: "2026-09-10",
  }, "airport-mismatch", "https://flight.qunar.com/site/oneway_list.htm");

  assert.equal(offers[0]?.segments[0]?.origin.code, "PKX");
  assert.equal(offers[0]?.segments[0]?.destination.code, "PVG");
  assert.equal(offers[0]?.comparable, false);
  assert.deepEqual(
    offers[0]?.incomparabilityReasons.filter((reason) => reason.endsWith("AIRPORT_CONFLICT")),
    ["ORIGIN_AIRPORT_CONFLICT", "DESTINATION_AIRPORT_CONFLICT"],
  );
});

test("combines two independently priced one-way results as a disclosed split ticket", () => {
  const make = (from: string, to: string, date: string, flight: string, price: string) => mapFlyAiFlightPayload({
    status: 0,
    data: { itemList: [{
      adultPrice: price,
      jumpUrl: `https://example.com/${from.toLowerCase()}-${to.toLowerCase()}`,
      journeys: [{ totalDuration: "120分钟", segments: [{
        depStationCode: from,
        depStationName: from,
        depDateTime: `${date} 08:00:00`,
        arrStationCode: to,
        arrStationName: to,
        arrDateTime: `${date} 10:00:00`,
        duration: "120分钟",
        marketingTransportNo: flight,
      }] }],
    }] },
  }, { ...intent, origin: { kind: "airport", code: from }, destination: { kind: "airport", code: to }, departureDate: date }, `${from}-${to}`);
  const combined = combineSplitTicketOffers(
    make("XIY", "NNG", "2026-09-11", "MU1234", "¥500"),
    make("NNG", "XIY", "2026-09-19", "MU4321", "¥600"),
    "tongcheng",
    "split-request",
  );
  assert.equal(combined[0]?.purchaseMode, "split_ticket");
  assert.equal(combined[0]?.legs.length, 2);
  assert.equal(combined[0]?.purchaseParts?.length, 2);
  assert.equal(combined[0]?.totalPrice.amountMinor, 110_000);
  assert.equal(combined[0]?.comparable, false);
  assert.ok(combined[0]?.incomparabilityReasons.includes("SPLIT_TICKET_SEPARATE_PURCHASES"));
});

test("maps Ctrip batchSearch base fare and tax as provider-verified adult total", () => {
  const offers = mapCtripBatchSearchPayload({
    data: {
      context: { searchId: "ctrip-search" },
      flightItineraryList: [{
        itineraryId: "itinerary-ctrip",
        priceList: [{ adultPrice: 520, adultTax: 50 }],
        flightSegments: [{
          flightList: [{
            flightNo: "MU5101",
            marketAirlineCode: "MU",
            departureAirportCode: "SHA",
            arrivalAirportCode: "PEK",
            departureDateTime: "2026-09-10 08:30:00",
            arrivalDateTime: "2026-09-10 10:50:00",
            duration: "140分钟",
          }],
        }],
      }],
    },
  }, { ...intent, origin: { kind: "airport", code: "SHA" }, destination: { kind: "airport", code: "PEK" }, adults: 2 }, "ctrip-request", "https://flights.ctrip.com/online/list/oneway-sha-pek");

  assert.equal(offers.length, 1);
  assert.equal(offers[0]?.totalPrice.amountMinor, 114_000);
  assert.equal(offers[0]?.priceVerificationStatus, "provider_response_verified");
  assert.equal(offers[0]?.segments[0]?.marketingCarrier, "MU");
  assert.equal(offers[0]?.segments[0]?.flightNumber, "5101");
  assert.match(offers[0]?.evidenceRef ?? "", /batchSearch:ctrip-search/);
});

test("does not treat a missing Ctrip tax field as zero tax", () => {
  const offers = mapCtripBatchSearchPayload({
    data: {
      flightItineraryList: [{
        priceList: [{ adultPrice: 520 }],
        flightSegments: [{
          flightList: [{
            flightNo: "MU5101",
            marketAirlineCode: "MU",
            departureAirportCode: "SHA",
            arrivalAirportCode: "PEK",
            departureDateTime: "2026-09-10 08:30:00",
            arrivalDateTime: "2026-09-10 10:50:00",
            duration: "140分钟",
          }],
        }],
      }],
    },
  }, { ...intent, origin: { kind: "airport", code: "SHA" }, destination: { kind: "airport", code: "PEK" } }, "ctrip-missing-tax", "https://flights.ctrip.com/online/list/oneway-sha-pek");

  assert.equal(offers[0]?.priceVerificationStatus, "listed_only");
  assert.equal(offers[0]?.comparable, false);
  assert.deepEqual(offers[0]?.priceComponents.map((component) => component.kind), ["required_service"]);
  assert.ok(offers[0]?.incomparabilityReasons.includes("PRICE_TAX_UNVERIFIED"));
});

test("registers the four V1 domestic real-source connectors without credentials in code", () => {
  const registry = createConnectorRegistry({
    flyAiEnabled: true,
    browserOtaEnabled: true,
    browserExecutablePath: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  });
  assert.deepEqual(
    registry.map((connector) => connector.metadata.id),
    ["fliggy-flyai", "ctrip-browser", "qunar-browser", "tongcheng-browser"],
  );
});

test("excludes domestic-only browser connectors from international searches", () => {
  const registry = createConnectorRegistry({ browserOtaEnabled: true });
  const qunar = registry.find((connector) => connector.metadata.id === "qunar-browser")!;
  const tongcheng = registry.find((connector) => connector.metadata.id === "tongcheng-browser")!;
  const ctrip = registry.find((connector) => connector.metadata.id === "ctrip-browser")!;
  assert.deepEqual(connectorApplicability(qunar, intent), { applicable: false, reason: "MARKET_UNSUPPORTED" });
  assert.deepEqual(connectorApplicability(tongcheng, intent), { applicable: false, reason: "MARKET_UNSUPPORTED" });
  assert.deepEqual(connectorApplicability(ctrip, intent), { applicable: true });
});

test("bounds FlightAPI calls per process and never probes credits in health", async (t) => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: URL[] = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input) => {
    requestedUrls.push(new URL(input instanceof URL ? input.href : String(input)));
    return new Response(JSON.stringify(flightApiPayload), { status: 200 });
  };

  const connector = new FlightApiConnector({
    apiKey: "secret-key",
    baseUrl: "https://api.flightapi.io",
    maxSearchesPerProcess: 1,
  });
  const health = await connector.health(new AbortController().signal);
  assert.equal(health.state, "degraded");
  assert.equal(requestedUrls.length, 0);

  const result = await connector.search(intent, {
    requestId: "request-flightapi",
    signal: new AbortController().signal,
  });
  assert.equal(result.offers.length, 1);
  assert.equal(
    requestedUrls[0]?.pathname,
    "/onewaytrip/secret-key/PVG/NRT/2026-08-24/1/0/0/Economy/CNY",
  );
  await assert.rejects(
    () => connector.search(intent, {
      requestId: "request-flightapi-2",
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      error instanceof ConnectorError && error.code === "FLIGHTAPI_PROCESS_CAP_REACHED",
  );
});

test("marks only explicit Amadeus and Duffel live credentials as production", () => {
  assert.equal(amadeusEnvironment("https://api.amadeus.com"), "production");
  assert.equal(amadeusEnvironment("https://test.api.amadeus.com"), "sandbox");
  assert.equal(amadeusEnvironment("https://amadeus.proxy.invalid"), "sandbox");
  assert.equal(duffelEnvironment("duffel_live_configured"), "production");
  assert.equal(duffelEnvironment("duffel_test_configured"), "sandbox");
  assert.equal(duffelEnvironment("unknown-token-format"), "sandbox");
});

test("maps Amadeus production fares as verification-only evidence", () => {
  const offers = mapAmadeusOffer(amadeusOffer, "production", "request-amadeus");

  assert.equal(offers.length, 1);
  assert.equal(offers[0]?.environment, "production");
  assert.equal(offers[0]?.totalPrice.amountMinor, 120_000);
  assert.equal(offers[0]?.seller.deepLink, undefined);
  assert.equal(offers[0]?.refundable, null);
  assert.equal(offers[0]?.comparable, false);
  assert.deepEqual(offers[0]?.incomparabilityReasons, ["NO_PURCHASE_HANDOFF"]);
});

test("sends a bounded Amadeus Flight Offers request and reuses its OAuth token", async (t) => {
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
    if (url.pathname === "/v1/security/oauth2/token") {
      return new Response(JSON.stringify({ access_token: "access", expires_in: 900 }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify({ data: [amadeusOffer] }), {
      status: 200,
      headers: { "ama-request-id": "ama-request-1" },
    });
  };

  const connector = new AmadeusConnector({
    clientId: "client",
    clientSecret: "secret",
    baseUrl: "https://test.api.amadeus.com",
  });
  const context = { requestId: "request-amadeus", signal: new AbortController().signal };
  const first = await connector.search(intent, context);
  await connector.search(intent, context);

  const offerRequest = requestedUrls.find((url) =>
    url.pathname === "/v2/shopping/flight-offers",
  );
  assert.equal(requestedUrls.filter((url) => url.pathname.includes("oauth2")).length, 1);
  assert.equal(offerRequest?.searchParams.get("originLocationCode"), "PVG");
  assert.equal(offerRequest?.searchParams.get("destinationLocationCode"), "NRT");
  assert.equal(offerRequest?.searchParams.get("max"), "50");
  assert.equal(first.providerRequestId, "ama-request-1");
  assert.equal(first.offers[0]?.environment, "sandbox");
});

test("maps and requests Duffel offers without promoting test data to live", async (t) => {
  const mapped = mapDuffelOffer(duffelOffer, "production", "request-duffel");
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.totalPrice.amountMinor, 90_000);
  assert.equal(mapped[0]?.seller.name, "Example Airline");
  assert.equal(mapped[0]?.comparable, false);
  assert.deepEqual(mapped[0]?.incomparabilityReasons, ["NO_PURCHASE_HANDOFF"]);

  const originalFetch = globalThis.fetch;
  let requestBody: unknown;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      data: { id: "offer-request-1", offers: [duffelOffer] },
    }), { status: 200 });
  };

  const connector = new DuffelConnector({
    accessToken: "duffel_test_configured",
    baseUrl: "https://api.duffel.com",
  });
  const result = await connector.search(intent, {
    requestId: "request-duffel",
    signal: new AbortController().signal,
  });

  assert.equal(connector.metadata.environment, "sandbox");
  assert.deepEqual(requestBody, {
    data: {
      slices: [{ origin: "PVG", destination: "NRT", departure_date: "2026-08-24" }],
      passengers: [{ id: "adult-1", type: "adult" }],
      cabin_class: "economy",
      max_connections: 1,
    },
  });
  assert.equal(result.providerRequestId, "offer-request-1");
  assert.equal(result.offers[0]?.environment, "sandbox");
});

test("expands only configured nearby origin airports for SerpApi", () => {
  assert.deepEqual(
    serpApiOriginSelection({
      ...intent,
      origin: { kind: "airport", code: "PVG" },
      includeNearbyAirports: true,
    }),
    {
      departureId: "PVG,SHA",
      notes: ["NEARBY_ORIGIN_EXPANDED:PVG,SHA"],
    },
  );
  assert.deepEqual(
    serpApiOriginSelection({
      ...intent,
      origin: { kind: "airport", code: "CAN" },
      includeNearbyAirports: true,
    }),
    {
      departureId: "CAN",
      notes: ["NEARBY_ORIGIN_NO_CONFIGURED_ALTERNATIVES:CAN"],
    },
  );
  assert.deepEqual(serpApiOriginSelection(intent), {
    departureId: "PVG",
    notes: [],
  });
});

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
    search: async () => ({
      offers: [],
      notes: ["NEARBY_ORIGIN_PROVIDER_EXPANSION:PVG"],
    }),
  };
  const execution = await executeConnector(connector, intent, crypto.randomUUID(), 100);
  assert.equal(execution.report.state, "empty");
  assert.equal(
    execution.report.notes.includes("NEARBY_ORIGIN_PROVIDER_EXPANSION:PVG"),
    true,
  );
});

test("enforces a hard deadline when a connector ignores its abort signal", async () => {
  const slowConnector: FlightConnector = {
    metadata: {
      id: "ignores-abort",
      name: "Ignores abort",
      kind: "aggregator",
      environment: "production",
      authorization: "partner_api",
      resultRole: "verification",
      handoff: "none",
      configured: true,
    },
    health: async () => ({ state: "healthy", checkedAt: new Date().toISOString() }),
    search: async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return { offers: [] };
    },
  };
  const startedAt = Date.now();
  const execution = await executeConnector(slowConnector, intent, "hard-timeout", 15, {
    maxRetries: 0,
    cacheTtlMs: 0,
    staleIfErrorMs: 0,
  });

  assert.equal(execution.report.state, "timeout");
  assert.equal(execution.report.errorCode, "CONNECTOR_TIMEOUT");
  assert.ok(Date.now() - startedAt < 100);
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
  assert.equal(offers[0]?.priceVerificationStatus, "detail_verified");
  assert.match(offers[0]?.evidenceRef ?? "", /^serpapi-booking-options:/);
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

test("maps initial SerpApi prices as disclosed search-result fallbacks", () => {
  const offers = mapSerpApiSearchChoices(
    [{
      price: 880,
      total_duration: 180,
      flights: [{
        departure_airport: { id: "PVG", time: "2026-08-24 09:00" },
        arrival_airport: { id: "NRT", time: "2026-08-24 13:00" },
        duration: 180,
        flight_number: "MU 523",
      }],
    }],
    intent,
    "request-initial",
    "https://www.google.com/travel/flights?hl=en&curr=CNY&tfs=opaque",
    "provider-initial",
  );

  assert.equal(offers.length, 1);
  assert.equal(offers[0]?.seller.name, "Google Flights");
  assert.equal(offers[0]?.seller.handoffPrecision, "search_results");
  assert.equal(offers[0]?.priceVerificationStatus, "listed_only");
  assert.equal(offers[0]?.totalPrice.amountMinor, 88_000);
  assert.equal(offers[0]?.comparable, true);
  assert.deepEqual(
    mapSerpApiSearchChoices(
      [{ price: 880 }],
      {
        ...intent,
        tripType: "round_trip",
        returnDate: "2026-08-29",
      },
      "request-incomplete-round-trip",
      "https://www.google.com/travel/flights?hl=en&curr=CNY&tfs=opaque",
    ),
    [],
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
        this_month_usage: 0,
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

test("bounds a one-way SerpApi search to its five reserved credits", async (t) => {
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
    if (url.pathname === "/account.json") {
      return new Response(JSON.stringify({
        account_status: "Active",
        plan_monthly_price: 0,
        total_searches_left: 250,
        this_month_usage: 0,
      }), { status: 200 });
    }
    if (url.searchParams.has("booking_token")) {
      return new Response(JSON.stringify({ booking_options: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({
      best_flights: Array.from({ length: 8 }, (_, index) => ({
        booking_token: `booking-${index}`,
        flights: [{
          departure_airport: { id: "PVG", time: "2026-08-24 09:00" },
          arrival_airport: { id: "NRT", time: "2026-08-24 13:00" },
        }],
      })),
    }), { status: 200 });
  };

  const connector = new SerpApiGoogleFlightsConnector({
    apiKey: "test",
    baseUrl: "https://serpapi.test",
  });
  await connector.search(intent, {
    requestId: "request-bounded",
    signal: new AbortController().signal,
  });

  const searchRequests = requestedUrls.filter((url) => url.pathname === "/search.json");
  assert.equal(serpApiRequiredCredits("one_way"), 5);
  assert.equal(serpApiRequiredCredits("round_trip"), 9);
  assert.equal(searchRequests.length, serpApiRequiredCredits("one_way"));
  assert.equal(
    searchRequests.filter((url) => url.searchParams.has("booking_token")).length,
    4,
  );
});

test("keeps real initial results when every Booking Options request fails", async (t) => {
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
    if (url.pathname === "/account.json") {
      return new Response(JSON.stringify({
        account_status: "Active",
        plan_monthly_price: 0,
        total_searches_left: 250,
        this_month_usage: 0,
      }), { status: 200 });
    }
    if (url.searchParams.has("booking_token")) {
      throw new DOMException("Booking lookup timed out.", "AbortError");
    }
    return new Response(JSON.stringify({
      search_metadata: {
        id: "search-fallback",
        google_flights_url:
          "https://www.google.com/travel/flights?hl=en&curr=CNY&tfs=opaque",
      },
      best_flights: [{
        booking_token: "booking-fallback",
        price: 880,
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
    requestId: "request-fallback",
    signal: new AbortController().signal,
  });

  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0]?.seller.handoffPrecision, "search_results");
  assert.equal(
    result.notes?.includes("SERPAPI_BOOKING_OPTIONS_PARTIAL_FAILURE:1/1"),
    true,
  );
  assert.equal(
    result.notes?.includes(
      "SERPAPI_INITIAL_RESULTS_FALLBACK:SEARCH_RESULTS_HANDOFF_REQUIRES_REVALIDATION",
    ),
    true,
  );
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

test("refuses SerpApi before search when the monthly safety cap would be exceeded", async (t) => {
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
      plan_monthly_price: 0,
      total_searches_left: 52,
      this_month_usage: 198,
    }), { status: 200 });
  };

  const connector = new SerpApiGoogleFlightsConnector({
    apiKey: "test",
    baseUrl: "https://serpapi.test",
    monthlyCreditCap: 200,
  });
  await assert.rejects(
    connector.search(intent, {
      requestId: "request-monthly-cap",
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      error instanceof ConnectorError &&
      error.code === "SERPAPI_MONTHLY_CREDIT_CAP_REACHED",
  );
  assert.deepEqual(requestedUrls.map((url) => url.pathname), ["/account.json"]);
});

test("fails closed when SerpApi omits the monthly usage field", async (t) => {
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
      plan_monthly_price: 0,
      total_searches_left: 250,
    }), { status: 200 });
  };

  const connector = new SerpApiGoogleFlightsConnector({
    apiKey: "test",
    baseUrl: "https://serpapi.test",
    monthlyCreditCap: 200,
  });
  await assert.rejects(
    connector.search(intent, {
      requestId: "request-usage-missing",
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      error instanceof ConnectorError &&
      error.code === "SERPAPI_MONTHLY_CREDIT_CAP_REACHED",
  );
  assert.deepEqual(requestedUrls.map((url) => url.pathname), ["/account.json"]);
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

test("maps Edge companion round-trip cards into truthful split-ticket offers", async () => {
  const roundTripIntent: SearchIntent = {
    ...intent,
    tripType: "round_trip",
    origin: { kind: "airport", code: "XIY" },
    destination: { kind: "airport", code: "NNG" },
    departureDate: "2026-09-11",
    returnDate: "2026-09-19",
  };
  const connector = new CompanionOtaConnector("tongcheng", {
    platform: "tongcheng",
    journeys: [
      {
        direction: "outbound",
        state: "success",
        bookingUrl: "https://www.ly.com/flights/outbound",
        fetchedAt: "2026-08-11T08:00:00.000Z",
        cards: [{
          cardText: "中国南方航空 CZ3275 直飞",
          flightNumberText: "中国南方航空 CZ3275",
          airlineName: "中国南方航空",
          departureTime: "08:10",
          arrivalTime: "10:45",
          departureAirport: "咸阳国际机场 T3",
          arrivalAirport: "吴圩国际机场 T2",
          priceText: "¥520",
        }],
      },
      {
        direction: "inbound",
        state: "success",
        bookingUrl: "https://www.ly.com/flights/inbound",
        fetchedAt: "2026-08-11T08:00:02.000Z",
        cards: [{
          cardText: "厦门航空 MF8292 直飞",
          flightNumberText: "厦门航空 MF8292",
          airlineName: "厦门航空",
          departureTime: "12:00",
          arrivalTime: "14:35",
          departureAirport: "吴圩国际机场 T2",
          arrivalAirport: "咸阳国际机场 T3",
          priceText: "¥480",
        }],
      },
    ],
  });

  const result = await connector.search(roundTripIntent, {
    requestId: "edge-round-trip",
    signal: AbortSignal.timeout(1_000),
  });
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0]?.connectorId, "tongcheng-edge-companion");
  assert.equal(result.offers[0]?.purchaseMode, "split_ticket");
  assert.equal(result.offers[0]?.purchaseParts?.length, 2);
  assert.equal(result.offers[0]?.totalPrice.amountMinor, 100_000);
  assert.equal(result.offers[0]?.comparable, false);
});

test("replaces duplicate inventory families with Edge companion connectors", () => {
  const serverConnector: FlightConnector = {
    metadata: {
      id: "server-fliggy",
      name: "Server Fliggy",
      kind: "ota",
      environment: "production",
      authorization: "browser_session",
      resultRole: "purchase_handoff",
      handoff: "deep_link",
      inventoryFamily: "fliggy",
      configured: true,
    },
    health: async () => ({ state: "healthy", checkedAt: new Date().toISOString() }),
    search: async () => ({ offers: [] }),
  };
  const merged = withCompanionConnectors([serverConnector], [{
    platform: "fliggy",
    journeys: [{
      direction: "outbound",
      state: "success",
      bookingUrl: "https://sjipiao.fliggy.com/flight_search_result.htm",
      fetchedAt: "2026-08-11T08:00:00.000Z",
      cards: [{
        cardText: "东方航空 MU1234 08:00 10:00 咸阳机场 吴圩机场 ¥500",
        flightNumberText: "MU1234",
        airlineName: "东方航空",
        departureTime: "08:00",
        arrivalTime: "10:00",
        departureAirport: "咸阳机场",
        arrivalAirport: "吴圩机场",
        priceText: "¥500",
      }],
    }],
  }], { ...intent, origin: { kind: "airport", code: "XIY" }, destination: { kind: "airport", code: "NNG" } });
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.metadata.id, "fliggy-edge-companion");
  assert.equal(merged[0]?.metadata.capabilities?.executionLocation, "user_browser");
});

test("retains a working server connector when Edge companion evidence failed", () => {
  const serverConnector: FlightConnector = {
    metadata: {
      id: "fliggy-flyai",
      name: "FlyAI",
      kind: "ota",
      environment: "production",
      authorization: "self_service_api",
      resultRole: "purchase_handoff",
      handoff: "deep_link",
      inventoryFamily: "fliggy",
      configured: true,
    },
    health: async () => ({ state: "healthy", checkedAt: new Date().toISOString() }),
    search: async () => ({ offers: [] }),
  };
  const merged = withCompanionConnectors([serverConnector], [{
    platform: "fliggy",
    journeys: [{
      direction: "outbound",
      state: "page_changed",
      bookingUrl: "https://sjipiao.fliggy.com/flight_search_result.htm",
      fetchedAt: "2026-08-11T08:00:00.000Z",
      cards: [],
      errorCode: "FLIGGY_COMPANION_PAGE_CHANGED",
    }],
  }], intent);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.metadata.id, "fliggy-flyai");
  assert.equal(merged[0]?.metadata.capabilities?.executionLocation, undefined);
});
