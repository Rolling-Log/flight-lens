import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("single-source login resume reuses its tab without restarting other platforms", async () => {
  const session = {};
  const created = [], updates = [], removed = [], progress = [];
  let loggedIn = false;
  const sandbox = { URLSearchParams, setTimeout, clearTimeout, chrome: {
    runtime: { getManifest: () => ({ version: "0.2.0" }), onMessage: { addListener() {} } },
    windows: { update: async () => {} },
    tabs: {
      onUpdated: { addListener() {}, removeListener() {} },
      onRemoved: { addListener() {}, removeListener() {} },
      create: async (options) => { created.push(options); return { id: 7 }; },
      get: async () => ({ id: 7, status: "complete", windowId: 1 }),
      update: async (id, options) => { updates.push(options); return { id, windowId: 1 }; },
      remove: async (id) => { removed.push(id); },
      sendMessage: async (id, message) => {
        if (id === 100) { progress.push(message); return; }
        return { state: loggedIn ? "success" : "login_required", cards: [], fetchedAt: new Date().toISOString() };
      },
    },
    storage: {
      session: { get: async (key) => ({ [key]: session[key] }), set: async (value) => Object.assign(session, value), remove: async (key) => { delete session[key]; } },
      local: { set: async () => {} },
    },
  } };
  vm.runInNewContext(await readFile(new URL("../background.js", import.meta.url), "utf8"), sandbox);
  const intent = { origin: { code: "PEK" }, destination: { code: "SHA" }, departureDate: "2026-10-20", cabin: "economy", adults: 1, tripType: "one_way" };
  const first = await sandbox.searchAll(intent, ["qunar"], { tab: { id: 100 } }, "request-a");
  assert.equal(first.results[0].journeys[0].state, "login_required");
  assert.equal(removed.length, 0);
  assert.equal(updates.filter((options) => options.url).length, 0, "initial tab must not navigate twice");
  loggedIn = true;
  const second = await sandbox.searchAll(intent, ["qunar"], { tab: { id: 100 } }, "request-b");
  assert.equal(second.results.length, 1);
  assert.equal(second.results[0].platform, "qunar");
  assert.equal(second.results[0].journeys[0].state, "success");
  assert.equal(created.length, 1);
  assert.equal(updates.filter((options) => options.url).length, 1);
  assert.equal(removed.length, 1);
  assert.equal(Object.keys(session).length, 0);
  assert.equal(progress.length, 2);
});

async function paginationFixture({ pages = 11, stalled = false } = {}) {
  let current = 0, clock = 0;
  const next = { getClientRects: () => [1], getAttribute: () => null, innerText: "下一页", className: "next",
    click: () => { if (!stalled) current += 1; } };
  const sandbox = {
    Date: class extends Date { static now() { return clock; } },
    setTimeout: (fn, ms) => { clock += ms; fn(); },
    window: { addEventListener() {}, postMessage() {} },
    location: { href: "https://flight.qunar.com/site/oneway_list.htm", origin: "https://flight.qunar.com" },
    document: { body: { getAttribute: () => null, innerText: "航班结果" }, querySelectorAll: () => current < pages - 1 ? [next] : [] },
    chrome: { runtime: { onMessage: { addListener() {} } } },
  };
  vm.runInNewContext(await readFile(new URL("../platform-content.js", import.meta.url), "utf8"), sandbox);
  sandbox.blockingState = () => null;
  sandbox.extract = () => Array.from({ length: 20 }, (_, index) => ({ flightNumberText: `CZ${3000 + current * 20 + index}`, priceText: `¥${500 - current}` }));
  return sandbox.collect("qunar");
}

test("traverses eleven same-sized pages and keeps all 220 candidate cards", async () => {
  const result = await paginationFixture();
  assert.equal(result.cards.length, 220);
  assert.equal(result.coverage.pagesVisited, 11);
  assert.equal(result.coverage.status, "unknown", "list traversal does not certify every fare product");
  assert.equal(result.cards.at(-1).flightNumberText, "CZ3219");
});

test("stalled pagination returns partial evidence instead of silently claiming completion", async () => {
  const result = await paginationFixture({ stalled: true });
  assert.equal(result.cards.length, 20);
  assert.equal(result.coverage.status, "partial");
  assert.match(result.coverage.reason, /^PAGINATION_/);
});
