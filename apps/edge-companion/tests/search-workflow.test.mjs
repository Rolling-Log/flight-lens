import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("single-source login resume reuses its tab without restarting other platforms", async () => {
  const session = {};
  const created = [], updates = [], removed = [], progress = [];
  let loggedIn = false;
  let browserBlocked = false;
  const sandbox = { URLSearchParams, setTimeout, clearTimeout, chrome: {
    runtime: { getManifest: () => ({ version: "0.2.2" }), onMessage: { addListener() {} } },
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
        if (browserBlocked) throw new Error("Could not establish connection. Receiving end does not exist.");
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
  loggedIn = false;
  await sandbox.searchAll(intent, ["qunar"], { tab: { id: 100 } }, "request-c");
  browserBlocked = true;
  const failedResume = await sandbox.searchAll(intent, ["qunar"], { tab: { id: 100 } }, "request-d");
  assert.equal(failedResume.results[0].journeys[0].state, "unavailable");
  assert.equal(failedResume.results[0].journeys[0].cards.length, 0);
  assert.equal(Object.keys(session).length, 0, "browser-level blocking must not retain the old login task");
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

test("all supported mainland hubs search all four domestic platforms", async () => {
  const sandbox = { URLSearchParams, chrome: {
    runtime: { getManifest: () => ({ version: "0.2.2" }), onMessage: { addListener() {} } },
    storage: { local: { set: async () => {} } },
  } };
  vm.runInNewContext(await readFile(new URL("../background.js", import.meta.url), "utf8"), sandbox);
  sandbox.runPlatform = async (platform) => ({ platform, journeys: [] });
  for (const [code, city] of [["CGO", "郑州"], ["SYX", "三亚"], ["HAK", "海口"], ["URC", "乌鲁木齐"]]) {
    const intent = { origin: { code }, destination: { code: "SHA" }, departureDate: "2026-10-20" };
    const result = await sandbox.searchAll(intent, undefined, {}, "scope-proof");
    assert.equal(JSON.stringify(result.results.map((item) => item.platform)), JSON.stringify(["ctrip", "qunar", "tongcheng", "fliggy"]));
    const url = new URL(sandbox.buildUrl("qunar", intent));
    assert.equal(url.searchParams.get("searchDepartureAirport"), city);
  }
  const foreign = await sandbox.searchAll({ origin: { code: "NRT" }, destination: { code: "SHA" } }, undefined, {}, "foreign");
  assert.equal(JSON.stringify(foreign.results.map((item) => item.platform)), JSON.stringify(["ctrip"]));
});

async function contentFixture(body = "航班结果", platform = "qunar") {
  let clock = 0;
  const handlers = {};
  const sandbox = {
    Date: class extends Date { static now() { return clock; } },
    setTimeout: (fn, ms) => { clock += ms; fn(); },
    window: { addEventListener(type, listener) { handlers[type] = listener; }, postMessage() {} },
    location: { href: platform === "ctrip" ? "https://flights.ctrip.com/online/list/oneway-pek-sha?depdate=2026-10-20" : "https://flight.qunar.com/site/oneway_list.htm", origin: platform === "ctrip" ? "https://flights.ctrip.com" : "https://flight.qunar.com" },
    document: { body: { getAttribute: () => null, innerText: body }, querySelectorAll: () => [], querySelector: () => null },
    chrome: { runtime: { onMessage: { addListener() {} } } },
  };
  vm.runInNewContext(await readFile(new URL("../platform-content.js", import.meta.url), "utf8"), sandbox);
  return { sandbox, handlers };
}

test("Qunar scheduled closure remains searchable and is disclosed even during login", async () => {
  const notice = "去哪儿旅行网页版机票查询及预订服务将于 10月10日 起停止提供，请前往去哪儿旅行 App 查询、预订机票。";
  const { sandbox } = await contentFixture(`${notice} 请先登录`);
  const blocked = await sandbox.collect("qunar");
  assert.equal(blocked.state, "login_required");
  assert.equal(blocked.coverage.reason, "SERVICE_SUNSET_SCHEDULED_10_10");
  assert.match(blocked.errorCode, /LOGIN_REQUIRED_SERVICE_SUNSET_SCHEDULED_10_10$/);
  sandbox.document.body.innerText = notice;
  sandbox.extract = () => [{ flightNumberText: "MU5102", priceText: "¥500" }];
  const result = await sandbox.collect("qunar");
  assert.equal(result.state, "success");
  assert.match(result.coverage.reason, /CITY_SCOPE_POST_FILTER_SERVICE_SUNSET_SCHEDULED_10_10$/);
  assert.equal(sandbox.serviceNotice("ctrip"), null);
});

test("an explicit ended-service notice takes priority over login but app promotion alone does not", async () => {
  const { sandbox } = await contentFixture("网页版机票查询及预订服务已停止提供。请先登录");
  const ended = await sandbox.collect("qunar");
  assert.equal(ended.state, "unavailable");
  assert.equal(ended.errorCode, "QUNAR_COMPANION_WEB_SERVICE_ENDED");
  sandbox.document.body.innerText = "欢迎使用去哪儿旅行 App 查询、预订机票。";
  assert.equal(sandbox.serviceNotice("qunar"), null);
});

test("Ctrip shares only flight-level stop evidence and keeps DOM products separate", async () => {
  const { sandbox, handlers } = await contentFixture("航班结果", "ctrip");
  const dom = { cardText: "MU5102 经停 武汉 新客专享", flightNumberText: "MU5102 东方航空", airlineName: "东方航空", departureTime: "08:00", arrivalTime: "10:20", departureAirport: "首都国际机场", arrivalAirport: "虹桥国际机场", priceText: "¥450" };
  sandbox.actionCardRoots = () => [];
  sandbox.fallbackCard = () => dom;
  sandbox.first = () => null;
  // Avoid the airline DOM fallback, while retaining the actual extraction and merge.
  sandbox.cardsFor = () => [{ querySelectorAll: () => [] }];
  const structured = { ...dom, flightNumberText: "MU5102", cardText: "MU5102 08:00 首都国际机场 10:20 虹桥国际机场 ¥500", priceText: "¥500", evidenceKind: "structured_response", priceBreakdown: { currency: "CNY", baseFareMinor: 45000, taxMinor: 5000 } };
  handlers.message({ source: sandbox.window, origin: sandbox.location.origin, data: { channel: "flight-lens-ctrip-network", type: "CTRIP_BATCH_SEARCH_RESULT", pageUrl: sandbox.location.href, cards: [structured], fetchedAt: "2026-10-08T00:00:00.000Z" } });
  const cards = sandbox.extract("ctrip");
  assert.equal(cards.length, 2);
  assert.equal(cards[0].evidenceKind, "structured_response");
  assert.equal(cards[0].priceText, "¥500");
  assert.match(cards[0].cardText, /经停/);
  assert.doesNotMatch(cards[0].cardText, /新客|专享/);
  assert.equal(cards[1].evidenceKind, "dom");
  assert.match(cards[1].cardText, /新客专享/);
  assert.equal(cards[1].priceBreakdown, undefined);
  sandbox.location.href = sandbox.location.href.replace("2026-10-20", "2026-10-21");
  const changed = sandbox.extract("ctrip");
  assert.equal(changed[0].evidenceKind, "dom");
  assert.equal(changed[0].priceBreakdown, undefined);
});

test("public Ctrip products are not contaminated by another product's DOM eligibility, even at equal prices", async () => {
  const normalizer = { URL };
  vm.runInNewContext(await readFile(new URL("../ctrip-response.js", import.meta.url), "utf8"), normalizer);
  for (const domPrice of [500, 600]) {
    const { sandbox, handlers } = await contentFixture("航班结果", "ctrip");
    const dom = { cardText: `MU5102 新客专享 ¥${domPrice}`, flightNumberText: "MU5102", airlineName: "东方航空", departureTime: "08:00", arrivalTime: "10:20", departureAirport: "首都国际机场", arrivalAirport: "虹桥国际机场", priceText: `¥${domPrice}` };
    sandbox.cardsFor = () => [{ querySelectorAll: () => [] }];
    sandbox.actionCardRoots = () => [];
    sandbox.fallbackCard = () => dom;
    sandbox.first = () => null;
    const structured = normalizer.FlightLensCtripResponse.normalize({ data: { flightItineraryList: [{
      priceList: [{ cabin: "Y", adultPrice: 450, adultTax: 50, productName: "新客专享" }, { cabin: "Y", adultPrice: 550, adultTax: 50 }],
      flightSegments: [{ flightList: [{ flightNo: "MU5102", departureDateTime: "2026-10-20 08:00:00", arrivalDateTime: "2026-10-20 10:20:00", departureAirportName: dom.departureAirport, arrivalAirportName: dom.arrivalAirport }] }],
    }] } }, `${sandbox.location.href}&cabin=y`);
    handlers.message({ source: sandbox.window, origin: sandbox.location.origin, data: { channel: "flight-lens-ctrip-network", type: "CTRIP_BATCH_SEARCH_RESULT", pageUrl: sandbox.location.href, cards: structured, fetchedAt: "2026-10-08T00:00:00.000Z" } });
    const cards = sandbox.extract("ctrip");
    assert.equal(cards.length, 2);
    const publicProduct = cards.find((card) => card.evidenceKind === "structured_response");
    assert.equal(publicProduct.priceText, "¥600");
    assert.equal(publicProduct.priceBreakdown.baseFareMinor + publicProduct.priceBreakdown.taxMinor, 60000);
    assert.doesNotMatch(publicProduct.cardText, /新客|专享|经停/);
    const domProduct = cards.find((card) => card.evidenceKind === "dom");
    assert.equal(domProduct.priceText, `¥${domPrice}`);
    assert.match(domProduct.cardText, /新客专享/);
    assert.equal(domProduct.priceBreakdown, undefined);
  }
});
