import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createFetchHandler } from "../src/fetch-handler.js";

test("adapts a same-origin web request to Fastify", async () => {
  const app = Fastify();
  app.post("/v1/echo", async (request, reply) => {
    reply.header("x-flight-lens", "serverless");
    return {
      query: request.query,
      body: request.body,
      origin: request.headers.origin,
    };
  });
  const handle = createFetchHandler(async () => app);
  const response = await handle(
    new Request("https://staging.example/api/v1/echo?currency=CNY", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://staging.example",
      },
      body: JSON.stringify({ route: "PVG-NRT" }),
    }),
    ["v1", "echo"],
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-flight-lens"), "serverless");
  assert.deepEqual(await response.json(), {
    query: { currency: "CNY" },
    body: { route: "PVG-NRT" },
    origin: "https://staging.example",
  });
  await app.close();
});

test("does not attach a body to HEAD responses", async () => {
  const app = Fastify();
  app.get("/health", async () => ({ status: "ok" }));
  const handle = createFetchHandler(async () => app);
  const response = await handle(
    new Request("https://staging.example/api/health", { method: "HEAD" }),
    ["health"],
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
  await app.close();
});
