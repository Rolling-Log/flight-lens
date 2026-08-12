import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("treats blank optional credentials as unconfigured", () => {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: "",
    OPENAI_API_KEY: "   ",
    FLIGHTAPI_API_KEY: " ",
    SKYSCANNER_API_KEY: "",
    SERPAPI_API_KEY: "configured",
  });

  assert.equal(config.databaseUrl, undefined);
  assert.equal(config.openaiIntentParserEnabled, false);
  assert.equal(config.openaiApiKey, undefined);
  assert.equal(config.connectors.flightApiKey, undefined);
  assert.equal(config.connectors.flightApiMaxSearchesPerProcess, 10);
  assert.equal(config.connectors.skyscannerApiKey, undefined);
  assert.equal(config.connectors.serpApiKey, "configured");
  assert.equal(config.connectors.serpApiMonthlyCreditCap, 200);
});

test("requires an explicit opt-in before an injected OpenAI key can be used", () => {
  const disabled = loadConfig({
    NODE_ENV: "test",
    OPENAI_API_KEY: "platform-injected",
  });
  const enabled = loadConfig({
    NODE_ENV: "test",
    OPENAI_INTENT_PARSER_ENABLED: "true",
    OPENAI_API_KEY: "user-configured",
  });

  assert.equal(disabled.openaiIntentParserEnabled, false);
  assert.equal(enabled.openaiIntentParserEnabled, true);
});

test("prefers the platform PORT while retaining API_PORT for local development", () => {
  const local = loadConfig({ NODE_ENV: "test", API_PORT: "4100" });
  assert.equal(local.host, "::");
  assert.equal(local.port, 4100);
  assert.equal(
    loadConfig({ NODE_ENV: "production", PORT: "8080", API_PORT: "4100" }).port,
    8080,
  );
});

test("keeps connector and audit work within bounded request budgets", () => {
  const defaults = loadConfig({ NODE_ENV: "production" });
  assert.equal(defaults.connectorTimeoutMs, 20_000);
  assert.equal(defaults.auditTimeoutMs, 3_000);
  assert.equal(defaults.searchRateLimitMax, 2);
  assert.equal(defaults.monitorBatchMax, 5);
  assert.equal(defaults.monitorExecutionTimeoutMs, 45_000);
  assert.equal(
    loadConfig({ NODE_ENV: "production", CONNECTOR_TIMEOUT_MS: "12000" }).connectorTimeoutMs,
    12_000,
  );
  assert.equal(
    loadConfig({ NODE_ENV: "production", AUDIT_TIMEOUT_MS: "1500" }).auditTimeoutMs,
    1_500,
  );
  assert.equal(
    loadConfig({ NODE_ENV: "test", SEARCH_RATE_LIMIT_MAX: "100" }).searchRateLimitMax,
    100,
  );
});

test("bounds monitor wake batches and keeps the wake secret optional", () => {
  const configured = loadConfig({
    NODE_ENV: "production",
    MONITOR_WAKE_SECRET: "test-secret-value",
    MONITOR_BATCH_MAX: "3",
    MONITOR_EXECUTION_TIMEOUT_MS: "30000",
  });
  assert.equal(configured.monitorWakeSecret, "test-secret-value");
  assert.equal(configured.monitorBatchMax, 3);
  assert.equal(configured.monitorExecutionTimeoutMs, 30_000);
  assert.equal(loadConfig({ NODE_ENV: "test", MONITOR_WAKE_SECRET: " " }).monitorWakeSecret, undefined);
});

test("supports a bounded SerpApi monthly free-credit budget", () => {
  assert.equal(
    loadConfig({
      NODE_ENV: "production",
      SERPAPI_MONTHLY_CREDIT_CAP: "100",
    }).connectors.serpApiMonthlyCreditCap,
    100,
  );
});

test("supports a bounded FlightAPI local experiment budget", () => {
  const connectors = loadConfig({
    NODE_ENV: "test",
    FLIGHTAPI_API_KEY: "configured",
    FLIGHTAPI_MAX_SEARCHES_PER_PROCESS: "3",
  }).connectors;
  assert.equal(connectors.flightApiKey, "configured");
  assert.equal(connectors.flightApiMaxSearchesPerProcess, 3);
});
