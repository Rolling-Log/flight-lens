import assert from "node:assert/strict";
import test from "node:test";
import type { FlightConnector } from "@flight-lens/connectors";
import { buildApp } from "../src/app.js";
import type { ApiConfig } from "../src/config.js";

const config: ApiConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 4000,
  webOrigins: ["http://localhost:3000"],
  logLevel: "silent",
  openaiModel: "gpt-5.6-luna",
  connectorTimeoutMs: 500,
  connectors: {
    skyscannerBaseUrl: "https://partners.api.skyscanner.net",
    serpApiBaseUrl: "https://serpapi.com",
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
