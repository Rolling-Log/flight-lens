import assert from "node:assert/strict";
import test from "node:test";
import type { FlightConnector } from "@flight-lens/connectors";
import type { Offer } from "@flight-lens/contracts";
import { buildApp } from "../src/app.js";
import type { ApiConfig } from "../src/config.js";

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
};
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

test("health discloses connector release readiness", async () => {
  const app = await buildApp({ config, connectors: [], auditStore: null, now: fixedNow });
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().connectors, {
    configured: 0,
    purchaseHandoffConfigured: 0,
    verificationConfigured: 0,
    releaseMinimumPurchaseHandoff: 2,
  });
  await app.close();
});

test("grants CORS only to an explicitly configured web origin", async () => {
  const app = await buildApp({ config, connectors: [], auditStore: null, now: fixedNow });
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

test("keeps the formal V1 search path to one adult and fixed dates", async () => {
  const app = await buildApp({ config, connectors: [], auditStore: null, now: fixedNow });
  const response = await app.inject({
    method: "POST",
    url: "/v1/searches",
    payload: { ...validIntent, adults: 2, flexibleDays: 3 },
  });

  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error.code, "V1_SCOPE_UNSUPPORTED");
  assert.deepEqual(response.json().error.fields, ["adults", "flexibleDays"]);
  await app.close();
});
