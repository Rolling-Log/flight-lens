import assert from "node:assert/strict";
import test from "node:test";
import type { FlightConnector } from "@flight-lens/connectors";
import type { Offer, PriceAlert } from "@flight-lens/contracts";
import { buildApp } from "../src/app.js";
import type { ApiConfig } from "../src/config.js";
import type { V2Store } from "@flight-lens/database";
import type { MonitorQueue } from "../src/monitor-queue.js";

const config: ApiConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 4000,
  webOrigins: ["http://localhost:3000"],
  logLevel: "silent",
  openaiIntentParserEnabled: false,
  openaiModel: "gpt-5.6-luna",
  connectorTimeoutMs: 500,
  auditTimeoutMs: 50,
  monitorBatchMax: 5,
  monitorExecutionTimeoutMs: 45_000,
  ntfyBaseUrl: "https://ntfy.sh",
  connectors: {
    skyscannerBaseUrl: "https://partners.api.skyscanner.net",
    serpApiBaseUrl: "https://serpapi.com",
    serpApiMonthlyCreditCap: 200,
    amadeusBaseUrl: "https://test.api.amadeus.com",
    duffelBaseUrl: "https://api.duffel.com",
  },
};

const validIntent = {
  schemaVersion: "1",
  tripType: "one_way",
  origin: { kind: "airport", code: "PVG" },
  destination: { kind: "airport", code: "NRT" },
  departureDate: "2026-08-24",
} as const;
const fixedNow = () => new Date("2026-07-30T00:00:00.000Z");

function comparableOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    schemaVersion: "1",
    id: "api-offer",
    sourceOfferId: "api-source-offer",
    connectorId: "api-trust",
    environment: "production",
    seller: {
      id: "seller",
      name: "Seller",
      kind: "ota",
      deepLink: "https://example.com/checkout",
      handoffPrecision: "exact_offer",
    },
    legs: [{
      id: "leg-0",
      segmentIds: ["segment-0"],
      origin: { kind: "airport", code: "PVG" },
      destination: { kind: "airport", code: "NRT" },
      departureAt: "2026-08-24T10:00:00+08:00",
      arrivalAt: "2026-08-24T14:00:00+09:00",
      durationMinutes: 180,
      stopCount: 0,
    }],
    segments: [{
      id: "segment-0",
      legIndex: 0,
      marketingCarrier: "MU",
      flightNumber: "521",
      origin: { kind: "airport", code: "PVG" },
      destination: { kind: "airport", code: "NRT" },
      departureAt: "2026-08-24T10:00:00+08:00",
      arrivalAt: "2026-08-24T14:00:00+09:00",
      durationMinutes: 180,
    }],
    priceComponents: [{
      kind: "required_service",
      label: "Total",
      amountMinor: 200000,
      currency: "CNY",
      required: true,
    }],
    totalPrice: { amountMinor: 200000, currency: "CNY" },
    totalPriceCny: { amountMinor: 200000, currency: "CNY" },
    baggage: [],
    refundable: null,
    changeable: null,
    eligibility: [],
    fetchedAt: "2026-07-30T00:00:00.000Z",
    comparable: true,
    incomparabilityReasons: [],
    qualityScore: 90,
    ...overrides,
  };
}

function readinessConnector(
  id: string,
  resultRole: FlightConnector["metadata"]["resultRole"],
  inventoryFamily: string,
): FlightConnector {
  return {
    metadata: {
      id,
      name: id,
      kind: "aggregator",
      environment: "production",
      authorization: "partner_api",
      resultRole,
      handoff: resultRole === "purchase_handoff" ? "deep_link" : "none",
      inventoryFamily,
      configured: true,
    },
    health: async () => ({ state: "healthy", checkedAt: fixedNow().toISOString() }),
    search: async () => ({ offers: [] }),
  };
}

test("health discloses connector release readiness", async () => {
  const app = await buildApp({ config, connectors: [], auditStore: null, now: fixedNow });
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().connectors, {
    configured: 0,
    purchaseHandoffConfigured: 0,
    verificationConfigured: 0,
    productionConfigured: 0,
    productionPurchaseHandoffConfigured: 0,
    productionVerificationConfigured: 0,
    productionInventoryFamilies: 0,
    releaseMinimumProductionSources: 4,
    releaseMinimumPurchaseHandoff: 2,
    releaseMinimumVerification: 2,
  });
  await app.close();
});

test("requires a truthful two-purchase plus two-verification production mix", async () => {
  const connectors = [
    readinessConnector("purchase-a", "purchase_handoff", "inventory-a"),
    readinessConnector("purchase-b", "purchase_handoff", "inventory-b"),
    readinessConnector("verification-a", "verification", "inventory-c"),
    readinessConnector("verification-b", "verification", "inventory-d"),
  ];
  const app = await buildApp({ config, connectors, auditStore: null, now: fixedNow });

  const metadata = await app.inject({ method: "GET", url: "/v1/meta/connectors" });
  assert.equal(metadata.statusCode, 200);
  assert.deepEqual(metadata.json().readiness, {
    operationalTargetMet: true,
    productionSources: 4,
    productionPurchaseHandoffSources: 2,
    productionVerificationSources: 2,
    productionInventoryFamilies: 4,
    target: {
      productionSources: 4,
      purchaseHandoffSources: 2,
      verificationSources: 2,
      inventoryFamilies: 4,
    },
  });

  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.json().connectors.productionInventoryFamilies, 4);
  await app.close();
});

test("grants CORS only to an explicitly configured web origin", async () => {
  const app = await buildApp({ config, connectors: [], auditStore: null, now: fixedNow });
  const preflight = await app.inject({
    method: "OPTIONS",
    url: "/v1/searches",
    headers: {
      origin: "http://localhost:3000",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
  const allowed = await app.inject({
    method: "GET",
    url: "/health",
    headers: { origin: "http://localhost:3000" },
  });
  const denied = await app.inject({
    method: "GET",
    url: "/health",
    headers: { origin: "https://untrusted.invalid" },
  });

  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], "http://localhost:3000");
  assert.match(preflight.headers["access-control-allow-methods"] ?? "", /POST/);
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.headers["access-control-allow-origin"], "http://localhost:3000");
  assert.equal(denied.statusCode, 200);
  assert.equal(denied.headers["access-control-allow-origin"], undefined);
  await app.close();
});

test("refuses to pretend demo data is a live search", async () => {
  const app = await buildApp({ config, connectors: [], auditStore: null, now: fixedNow });
  const response = await app.inject({
    method: "POST",
    url: "/v1/searches",
    payload: validIntent,
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error.code, "NO_LIVE_CONNECTORS");
  await app.close();
});

test("keeps form search available when the AI parser is unconfigured", async () => {
  const app = await buildApp({
    config,
    connectors: [],
    auditStore: null,
    intentParser: null,
    now: fixedNow,
  });
  const response = await app.inject({
    method: "POST",
    url: "/v1/intents/parse",
    payload: { text: "上海飞东京" },
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error.code, "INTENT_PARSER_UNCONFIGURED");
  await app.close();
});

test("uses deterministic local parsing when no OpenAI key is configured", async () => {
  const app = await buildApp({
    config,
    connectors: [],
    auditStore: null,
    now: fixedNow,
  });
  const response = await app.inject({
    method: "POST",
    url: "/v1/intents/parse",
    payload: {
      text: "2026年8月24日上海飞东京，单程，1位成人，直飞。",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ready, true);
  assert.equal(response.json().parser.kind, "local_deterministic_zh");
  assert.equal(response.json().intent.origin.code, "PVG");
  assert.equal(response.json().intent.destination.code, "NRT");
  await app.close();
});

test("returns transparent coverage for a configured empty source", async () => {
  const connector: FlightConnector = {
    metadata: {
      id: "test-live",
      name: "Test live",
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
  const app = await buildApp({
    config,
    connectors: [connector],
    auditStore: null,
    now: fixedNow,
  });
  const response = await app.inject({
    method: "POST",
    url: "/v1/searches",
    payload: validIntent,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().disclosure.successfulSources, 1);
  assert.equal(response.json().offers.length, 0);
  assert.equal(response.json().audit.persisted, false);
  await app.close();
});

test("excludes structurally unsupported connectors from planned coverage", async () => {
  let searched = false;
  const connector: FlightConnector = {
    metadata: {
      id: "economy-only",
      name: "Economy only",
      kind: "ota",
      environment: "production",
      authorization: "browser_session",
      resultRole: "purchase_handoff",
      handoff: "deep_link",
      configured: true,
      capabilities: {
        tripTypes: ["one_way"],
        markets: ["domestic_cn", "international"],
        locationKinds: ["airport"],
        cabins: ["economy"],
        maxAdults: 1,
        roundTripMode: "unsupported",
        priceEvidence: ["listed"],
        dataAccess: ["dom"],
        credentialRequirement: "browser_session",
        humanInteraction: "login_or_verification_possible",
        executionLocation: "server",
      },
    },
    health: async () => ({ state: "healthy", checkedAt: new Date().toISOString() }),
    search: async () => { searched = true; return { offers: [] }; },
  };
  const app = await buildApp({ config, connectors: [connector], auditStore: null, now: fixedNow });
  const response = await app.inject({
    method: "POST",
    url: "/v1/searches",
    payload: { ...validIntent, cabin: "business" },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(searched, false);
  assert.equal(response.json().disclosure.plannedSources, 0);
  assert.equal(response.json().connectorReports[0].state, "unsupported_query");
  await app.close();
});

test("uses Edge companion evidence instead of the duplicate server connector", async () => {
  let serverSearched = false;
  const serverConnector: FlightConnector = {
    metadata: {
      id: "ctrip-server",
      name: "Ctrip server",
      kind: "ota",
      environment: "production",
      authorization: "browser_session",
      resultRole: "purchase_handoff",
      handoff: "deep_link",
      inventoryFamily: "ctrip",
      configured: true,
    },
    health: async () => ({ state: "healthy", checkedAt: new Date().toISOString() }),
    search: async () => { serverSearched = true; return { offers: [] }; },
  };
  const app = await buildApp({
    config,
    connectors: [serverConnector],
    auditStore: null,
    now: fixedNow,
  });
  const response = await app.inject({
    method: "POST",
    url: "/v1/searches",
    payload: {
      intent: validIntent,
      companion: {
        protocolVersion: "1",
        extensionVersion: "0.1.0",
        results: [{
          platform: "ctrip",
          journeys: [{
            direction: "outbound",
            state: "success",
            bookingUrl: "https://flights.ctrip.com/online/list/oneway-pvg-nrt",
            fetchedAt: "2026-08-11T08:00:00.000Z",
            cards: [{
              cardText: "中国东方航空 MU521 直飞",
              flightNumberText: "中国东方航空 MU521",
              airlineName: "中国东方航空",
              departureTime: "10:00",
              arrivalTime: "14:00",
              departureAirport: "浦东国际机场 T1",
              arrivalAirport: "成田国际机场 T2",
              priceText: "¥1,299",
              evidenceKind: "structured_response",
            }],
          }],
        }],
      },
    },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(serverSearched, false);
  assert.equal(response.json().connectorReports[0].connectorId, "ctrip-edge-companion");
  assert.equal(response.json().offers[0].connectorId, "ctrip-edge-companion");
  assert.equal(response.json().offers[0].totalPrice.amountMinor, 129_900);
  assert.equal(response.json().offers[0].priceVerificationStatus, "provider_response_verified");
  await app.close();
});

test("returns adversarially blocked offers as non-comparable", async () => {
  const connector: FlightConnector = {
    metadata: {
      id: "api-trust",
      name: "API trust",
      kind: "aggregator",
      environment: "production",
      authorization: "self_service_api",
      resultRole: "purchase_handoff",
      handoff: "deep_link",
      configured: true,
    },
    health: async () => ({ state: "healthy", checkedAt: new Date().toISOString() }),
    search: async () => ({
      offers: [comparableOffer({ eligibility: ["NEW_CUSTOMER_ONLY"] })],
    }),
  };
  const app = await buildApp({
    config,
    connectors: [connector],
    auditStore: null,
    now: fixedNow,
  });
  const response = await app.inject({
    method: "POST",
    url: "/v1/searches",
    payload: validIntent,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().offers[0].comparable, false);
  assert.equal(
    response.json().offers[0].incomparabilityReasons.includes("CONDITIONAL_PRICE"),
    true,
  );
  assert.equal(response.json().lowestComparableOfferId, null);
  await app.close();
});

test("returns separate verifiable-all-in, recommendation, and split-ticket conclusions", async () => {
  const connector: FlightConnector = {
    metadata: {
      id: "separate-conclusions",
      name: "Separate conclusions",
      kind: "aggregator",
      environment: "production",
      authorization: "self_service_api",
      resultRole: "purchase_handoff",
      handoff: "deep_link",
      configured: true,
    },
    health: async () => ({ state: "healthy", checkedAt: new Date().toISOString() }),
    search: async () => ({
      offers: [
        comparableOffer({ id: "all-in", sourceOfferId: "all-in" }),
        comparableOffer({
          id: "split",
          sourceOfferId: "split",
          purchaseMode: "split_ticket",
          comparable: false,
          incomparabilityReasons: ["SPLIT_TICKET_SEPARATE_PURCHASES"],
          totalPrice: { amountMinor: 100000, currency: "CNY" },
          totalPriceCny: { amountMinor: 100000, currency: "CNY" },
          priceComponents: [{
            kind: "required_service",
            label: "Split displayed total",
            amountMinor: 100000,
            currency: "CNY",
            required: true,
          }],
        }),
      ],
    }),
  };
  const app = await buildApp({ config, connectors: [connector], auditStore: null, now: fixedNow });
  const response = await app.inject({ method: "POST", url: "/v1/searches", payload: validIntent });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().lowestComparableOfferId, "all-in");
  assert.equal(response.json().recommendedOfferId, "all-in");
  assert.equal(response.json().lowestSplitOfferId, "split");
  await app.close();
});

test("returns search results when audit persistence exceeds its runtime budget", async () => {
  const connector: FlightConnector = {
    metadata: {
      id: "bounded-audit",
      name: "Bounded audit",
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
  const app = await buildApp({
    config: { ...config, auditTimeoutMs: 10 },
    connectors: [connector],
    auditStore: {
      persist: async () => await new Promise<void>(() => undefined),
      close: async () => undefined,
    },
    now: fixedNow,
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/searches",
    payload: validIntent,
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().audit, {
    configured: true,
    persisted: false,
    errorCode: "AUDIT_PERSIST_TIMEOUT",
  });
  await app.close();
});

test("limits the quota-consuming search route more strictly than read-only APIs", async () => {
  const connector: FlightConnector = {
    metadata: {
      id: "rate-limit-search",
      name: "Rate limit search",
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
  const app = await buildApp({
    config,
    connectors: [connector],
    auditStore: null,
    now: fixedNow,
  });

  const search = () => app.inject({
    method: "POST",
    url: "/v1/searches",
    payload: validIntent,
  });
  assert.equal((await search()).statusCode, 200);
  assert.equal((await search()).statusCode, 200);
  const limited = await search();
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers["x-ratelimit-limit"], "2");

  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);
  await app.close();
});

test("reports live connector health without exposing credentials", async () => {
  const connector: FlightConnector = {
    metadata: {
      id: "health-test",
      name: "Health test",
      kind: "aggregator",
      environment: "production",
      authorization: "partner_api",
      resultRole: "purchase_handoff",
      handoff: "deep_link",
      configured: true,
    },
    health: async () => ({
      state: "healthy",
      checkedAt: fixedNow().toISOString(),
    }),
    search: async () => ({ offers: [] }),
  };
  const app = await buildApp({
    config,
    connectors: [connector],
    auditStore: null,
    now: fixedNow,
  });
  const response = await app.inject({
    method: "GET",
    url: "/v1/meta/connectors/health",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().healthy, 1);
  assert.equal(response.json().connectors[0].health.state, "healthy");
  await app.close();
});

test("rejects a search date in the past", async () => {
  const connector: FlightConnector = {
    metadata: {
      id: "past-date",
      name: "Past date",
      kind: "aggregator",
      environment: "sandbox",
      authorization: "self_service_api",
      resultRole: "verification",
      handoff: "none",
      configured: true,
    },
    health: async () => ({ state: "healthy", checkedAt: fixedNow().toISOString() }),
    search: async () => ({ offers: [] }),
  };
  const app = await buildApp({
    config,
    connectors: [connector],
    auditStore: null,
    now: fixedNow,
  });
  const response = await app.inject({
    method: "POST",
    url: "/v1/searches",
    payload: { ...validIntent, departureDate: "2026-07-29" },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "SEARCH_DATE_IN_PAST");
  await app.close();
});

test("supports multiple adults while keeping the V1 search path to fixed dates", async () => {
  const connector: FlightConnector = {
    ...readinessConnector("adult-search", "purchase_handoff", "adult-search"),
    search: async () => ({ offers: [comparableOffer()] }),
  };
  const app = await buildApp({ config, connectors: [connector], auditStore: null, now: fixedNow });
  const adultResponse = await app.inject({
    method: "POST",
    url: "/v1/searches",
    payload: { ...validIntent, adults: 2 },
  });
  assert.equal(adultResponse.statusCode, 200);
  assert.equal(adultResponse.json().intent.adults, 2);

  const response = await app.inject({
    method: "POST",
    url: "/v1/searches",
    payload: { ...validIntent, adults: 2, flexibleDays: 3 },
  });

  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error.code, "V1_SCOPE_UNSUPPORTED");
  assert.deepEqual(response.json().error.fields, ["flexibleDays"]);
  await app.close();
});

function v2StoreStub(overrides: Partial<V2Store> = {}): V2Store {
  return {
    history: async () => [],
    createAlert: async () => { throw new Error("not implemented"); },
    listAlerts: async () => [],
    getAlert: async () => null,
    getOwnedAlert: async () => null,
    setAlertStatus: async () => false,
    dueAlerts: async () => [],
    claimAlertRun: async () => null,
    finishAlertRun: async () => undefined,
    savePreferences: async () => undefined,
    getPreferences: async () => null,
    clearPreferences: async () => undefined,
    clearAlerts: async () => 0,
    close: async () => undefined,
    ...overrides,
  };
}

test("returns separate V2 price trends without merging price semantics", async () => {
  const history = [
    { amount: 120_000, at: "2026-07-27T00:00:00.000Z" },
    { amount: 110_000, at: "2026-07-28T00:00:00.000Z" },
    { amount: 90_000, at: "2026-07-29T00:00:00.000Z" },
  ].map(({ amount, at }, index) => ({
    id: crypto.randomUUID(),
    searchId: crypto.randomUUID(),
    itineraryFingerprint: "MU5102:PEK:SHA:2026-08-24",
    routeKey: "PEK-SHA",
    departureDate: "2026-08-24",
    returnDate: null,
    cabin: "economy" as const,
    connectorId: "verified-source",
    inventoryFamily: "verified-family",
    sellerId: "seller",
    sellerName: "Seller",
    observationKind: "verified_all_in" as const,
    baseAmountMinor: amount - 5_000,
    taxAmountMinor: 5_000,
    fuelAmountMinor: null,
    requiredServiceAmountMinor: null,
    totalAmountMinor: amount,
    currency: "CNY",
    totalAmountCnyMinor: amount,
    baggage: [],
    priceVerificationStatus: "detail_verified" as const,
    handoffPrecision: "exact_offer" as const,
    evidenceRef: `evidence-${index}`,
    observedAt: at,
  }));
  const app = await buildApp({
    config,
    connectors: [],
    auditStore: null,
    v2Store: v2StoreStub({ history: async () => history }),
    now: fixedNow,
  });
  const response = await app.inject({
    method: "GET",
    url: "/v2/prices/history?origin=PEK&destination=SHA&departureDate=2026-08-24",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().trends.verified_all_in.direction, "falling");
  assert.equal(response.json().trends.listed_only.direction, "insufficient_data");
  assert.equal(response.json().observations.length, 3);
  await app.close();
});

test("plans bounded V2 exploration without spending provider quota", async () => {
  const app = await buildApp({ config, connectors: [], auditStore: null, v2Store: null, now: fixedNow });
  const response = await app.inject({
    method: "POST",
    url: "/v2/searches/plan",
    payload: {
      intent: { ...validIntent, origin: { kind: "city", code: "BJS" }, destination: { kind: "city", code: "SHA" }, flexibleDays: 3, includeNearbyAirports: true },
      maximumCombinations: 4,
    },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().intents.length, 4);
  assert.equal(response.json().stoppedReason, "combination_budget_reached");
  await app.close();
});

test("protects monitor wake and respects the configured batch maximum", async () => {
  const enqueued: string[] = [];
  const queue: MonitorQueue = {
    start: async () => undefined,
    enqueue: async (alertId) => { enqueued.push(alertId); return alertId; },
    stop: async () => undefined,
  };
  const due = Array.from({ length: 5 }, (_, index) => ({ id: `00000000-0000-4000-8000-00000000000${index}` }));
  const app = await buildApp({
    config: { ...config, monitorWakeSecret: "monitor-secret-value", monitorBatchMax: 2 },
    connectors: [],
    auditStore: null,
    v2Store: v2StoreStub({ dueAlerts: async (limit) => due.slice(0, limit) as never }),
    monitorQueue: queue,
    now: fixedNow,
  });
  const denied = await app.inject({ method: "POST", url: "/internal/monitor/wake" });
  assert.equal(denied.statusCode, 401);
  const allowed = await app.inject({
    method: "POST",
    url: "/internal/monitor/wake",
    headers: { authorization: "Bearer monitor-secret-value" },
  });
  assert.equal(allowed.statusCode, 200);
  assert.deepEqual(allowed.json(), { due: 2, enqueued: 2, batchMaximum: 2 });
  assert.equal(enqueued.length, 2);
  await app.close();
});

function activeAlert(): PriceAlert {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    intent: { ...validIntent, adults: 1, cabin: "economy" as const, flexibleDays: 0, directOnly: false, maxStops: 1, avoidRedEye: false, minimumCheckedBaggageKg: 0, includeNearbyAirports: false, explicitFields: [], inferredFields: [], pendingQuestions: [] },
    targetAmountCnyMinor: 210_000,
    checkIntervalMinutes: 360,
    ntfyTopic: "flight-lens-test",
    status: "active" as const,
    nextCheckAt: fixedNow().toISOString(),
    lastCheckedAt: null,
    lastTriggeredAt: null,
    lastTriggeredAmountMinor: null,
    lastErrorCode: null,
    createdAt: fixedNow().toISOString(),
    updatedAt: fixedNow().toISOString(),
  };
}

test("queues an owned active alert for immediate verification", async () => {
  const queued: string[] = [];
  const queue: MonitorQueue = {
    start: async () => undefined,
    enqueue: async (alertId) => { queued.push(alertId); return "job-1"; },
    stop: async () => undefined,
  };
  const alert = activeAlert();
  const app = await buildApp({
    config,
    connectors: [],
    auditStore: null,
    v2Store: v2StoreStub({ getOwnedAlert: async (id, owner) => id === alert.id && owner === "owner-token-value" ? alert : null }),
    monitorQueue: queue,
    now: fixedNow,
  });
  const denied = await app.inject({ method: "POST", url: `/v2/alerts/${alert.id}/test` });
  assert.equal(denied.statusCode, 401);
  const accepted = await app.inject({
    method: "POST",
    url: `/v2/alerts/${alert.id}/test`,
    headers: { "x-flight-lens-owner": "owner-token-value" },
  });
  assert.equal(accepted.statusCode, 202);
  assert.deepEqual(queued, [alert.id]);
  await app.close();
});

test("clears all alerts owned by an anonymous token", async () => {
  const app = await buildApp({
    config,
    connectors: [],
    auditStore: null,
    v2Store: v2StoreStub({ clearAlerts: async (owner) => owner === "owner-token-value" ? 3 : 0 }),
    now: fixedNow,
  });
  const response = await app.inject({
    method: "DELETE",
    url: "/v2/alerts",
    headers: { "x-flight-lens-owner": "owner-token-value" },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { deleted: 3 });
  await app.close();
});

test("persists monitored history before a notification failure and records the retryable failure", async () => {
  const alert = activeAlert();
  const handlerRef: { current?: (alertId: string) => Promise<void> } = {};
  const queue: MonitorQueue = {
    start: async (value) => { handlerRef.current = value; },
    enqueue: async () => "job-1",
    stop: async () => undefined,
  };
  const persisted: unknown[] = [];
  const finished: Array<{ notificationSent: boolean; errorCode: string | null; amountCnyMinor: number | null }> = [];
  const connector: FlightConnector = {
    ...readinessConnector("monitor-source", "purchase_handoff", "monitor-family"),
    search: async () => ({ offers: [comparableOffer()] }),
  };
  const app = await buildApp({
    config,
    connectors: [connector],
    auditStore: { persist: async (payload) => { persisted.push(payload); }, close: async () => undefined },
    v2Store: v2StoreStub({
      getAlert: async () => alert,
      claimAlertRun: async () => "run-1",
      finishAlertRun: async (input) => { finished.push({ notificationSent: input.notificationSent, errorCode: input.errorCode, amountCnyMinor: input.amountCnyMinor }); },
    }),
    monitorQueue: queue,
    notifier: { send: async () => { throw new Error("ntfy unavailable"); } },
    now: fixedNow,
  });
  assert.ok(handlerRef.current);
  await handlerRef.current(alert.id);
  assert.equal(persisted.length, 1);
  assert.deepEqual(finished, [{ notificationSent: false, errorCode: "NOTIFICATION_FAILED", amountCnyMinor: 200_000 }]);
  await app.close();
});

test("does not execute the same alert twice inside one idempotency bucket", async () => {
  const alert = activeAlert();
  const handlerRef: { current?: (alertId: string) => Promise<void> } = {};
  let searches = 0;
  const queue: MonitorQueue = { start: async (value) => { handlerRef.current = value; }, enqueue: async () => "job", stop: async () => undefined };
  const connector: FlightConnector = {
    ...readinessConnector("monitor-dedupe", "purchase_handoff", "monitor-dedupe"),
    search: async () => { searches += 1; return { offers: [comparableOffer()] }; },
  };
  const app = await buildApp({
    config,
    connectors: [connector],
    auditStore: null,
    v2Store: v2StoreStub({ getAlert: async () => alert, claimAlertRun: async () => null }),
    monitorQueue: queue,
    now: fixedNow,
  });
  assert.ok(handlerRef.current);
  await handlerRef.current(alert.id);
  await handlerRef.current(alert.id);
  assert.equal(searches, 0);
  await app.close();
});
