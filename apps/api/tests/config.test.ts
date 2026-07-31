import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("treats blank optional credentials as unconfigured", () => {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: "",
    OPENAI_API_KEY: "   ",
    SKYSCANNER_API_KEY: "",
    SERPAPI_API_KEY: "configured",
  });

  assert.equal(config.databaseUrl, undefined);
  assert.equal(config.openaiIntentParserEnabled, false);
  assert.equal(config.openaiApiKey, undefined);
  assert.equal(config.connectors.skyscannerApiKey, undefined);
  assert.equal(config.connectors.serpApiKey, "configured");
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
  assert.equal(loadConfig({ NODE_ENV: "test", API_PORT: "4100" }).port, 4100);
  assert.equal(
    loadConfig({ NODE_ENV: "production", PORT: "8080", API_PORT: "4100" }).port,
    8080,
  );
});
