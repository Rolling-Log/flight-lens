import assert from "node:assert/strict";
import test from "node:test";
import { resolveApiBase } from "../src/api-base.js";

test("uses the separately hosted API during local development", () => {
  assert.equal(resolveApiBase(undefined, "localhost"), "http://127.0.0.1:4000");
  assert.equal(resolveApiBase(undefined, "127.0.0.1"), "http://127.0.0.1:4000");
});

test("requires the Railway API URL for public deployments", () => {
  assert.throws(
    () => resolveApiBase(undefined, "v1-candidate.example.netlify.app"),
    /Railway API/,
  );
});

test("honors an explicit API base without creating a double slash", () => {
  assert.equal(
    resolveApiBase("https://api.example.test/", "app.example.test"),
    "https://api.example.test",
  );
});
