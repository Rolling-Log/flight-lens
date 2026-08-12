import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));

test("uses a local-only MV3 bridge without remote code", async () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, "background.js");
  assert.equal(manifest.content_security_policy, undefined);
  const bridge = await readFile(new URL("page-bridge.js", root), "utf8");
  assert.match(bridge, /127\.0\.0\.1:3000/);
  assert.match(bridge, /localhost:3000/);
  assert.doesNotMatch(bridge, /https:\/\//);
});

test("declares exactly the four domestic OTA task runners", async () => {
  const background = await readFile(new URL("background.js", root), "utf8");
  assert.match(background, /\["ctrip", "qunar", "tongcheng", "fliggy"\]/);
  assert.doesNotMatch(background, /eval\(|new Function\(/);
});

test("normalizes current Ctrip batchSearch evidence without retaining the raw response", async () => {
  const source = await readFile(new URL("ctrip-response.js", root), "utf8");
  const sandbox = { URL };
  vm.runInNewContext(source, sandbox);
  const cards = sandbox.FlightLensCtripResponse.normalize({
    data: {
      flightItineraryList: [{
        itineraryId: "MU5102_20260910",
        flightSegments: [{
          flightList: [{
            flightNo: "MU5102",
            marketAirlineName: "东方航空",
            departureDateTime: "2026-09-10 08:00:00",
            arrivalDateTime: "2026-09-10 10:20:00",
            departureAirportName: "首都国际机场",
            departureTerminal: "T2",
            arrivalAirportName: "虹桥国际机场",
            arrivalTerminal: "T2",
          }],
        }],
        priceList: [{ cabin: "Y", adultPrice: 450, adultTax: 50 }],
      }],
    },
  }, "https://flights.ctrip.com/online/list/oneway-pek-sha?cabin=y");

  assert.equal(cards.length, 1);
  assert.equal(cards[0].flightNumberText, "MU5102");
  assert.equal(cards[0].priceText, "¥500");
  assert.equal(cards[0].evidenceKind, "structured_response");
  assert.equal("priceList" in cards[0], false);
});

test("runs the Ctrip response tap in the page main world before the DOM fallback", () => {
  const entry = manifest.content_scripts.find((item) => item.world === "MAIN");
  assert.deepEqual(entry.js, ["ctrip-response.js", "ctrip-network-tap.js"]);
  assert.equal(entry.run_at, "document_start");
  assert.deepEqual(entry.matches, ["https://*.ctrip.com/online/*"]);
});
