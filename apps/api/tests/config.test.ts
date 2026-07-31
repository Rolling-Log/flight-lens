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
  assert.equal(config.openaiApiKey, undefined);
  assert.equal(config.connectors.skyscannerApiKey, undefined);
  assert.equal(config.connectors.serpApiKey, "configured");
});
