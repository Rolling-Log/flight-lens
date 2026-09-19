import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const sandbox = { URL };
vm.runInNewContext(await readFile(new URL("../ctrip-response.js", import.meta.url), "utf8"), sandbox);

function normalize(price) {
  return sandbox.FlightLensCtripResponse.normalize({ data: { flightItineraryList: [{
    priceList: [price],
    flightSegments: [{ flightList: [{
      flightNo: "MU5102",
      departureDateTime: "2026-10-20 08:00:00",
      arrivalDateTime: "2026-10-20 10:20:00",
      departureAirportName: "首都国际机场",
      arrivalAirportName: "虹桥国际机场",
    }] }],
  }] } }, "https://flights.ctrip.com/online/list/oneway-pek-sha?cabin=y");
}

test("missing or invalid tax never becomes evidence of a zero-tax fare", () => {
  for (const adultTax of [undefined, null, "", " ", -1, "unknown", false]) {
    const [card] = normalize({ cabin: "Y", adultPrice: 450, adultTax });
    assert.equal(card.priceText, "¥450");
    assert.equal(card.priceBreakdown, undefined);
  }
});

test("explicit zero tax is distinct from missing tax and decimal fares stay exact", () => {
  const [zeroTax] = normalize({ cabin: "Y", adultPrice: "450.25", adultTax: "0" });
  assert.equal(zeroTax.priceText, "¥450.25");
  assert.equal(zeroTax.priceBreakdown.baseFareMinor, 45025);
  assert.equal(zeroTax.priceBreakdown.taxMinor, 0);
  const [taxed] = normalize({ cabin: "Y", adultPrice: 450.25, adultTax: 120.5 });
  assert.equal(taxed.priceText, "¥570.75");
  assert.equal(taxed.priceBreakdown.taxMinor, 12050);
});

test("sort-only fares carry no tax proof and a different cabin is not substituted", () => {
  const [sortOnly] = normalize({ cabin: "Y", sortPrice: 600, adultTax: 50 });
  assert.equal(sortOnly.priceBreakdown, undefined);
  assert.equal(normalize({ cabin: "C", adultPrice: 450, adultTax: 50 }).length, 0);
});
