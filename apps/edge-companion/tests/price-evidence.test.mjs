import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const sandbox = { URL };
vm.runInNewContext(await readFile(new URL("../ctrip-response.js", import.meta.url), "utf8"), sandbox);

function normalize(price, flightOverrides = {}, pageUrl = "https://flights.ctrip.com/online/list/oneway-pek-sha?depdate=2026-10-20&cabin=y") {
  return sandbox.FlightLensCtripResponse.normalize({ data: { flightItineraryList: [{
    priceList: Array.isArray(price) ? price : [price],
    flightSegments: [{ flightList: [{
      flightNo: "MU5102",
      departureDateTime: "2026-10-20 08:00:00",
      arrivalDateTime: "2026-10-20 10:20:00",
      departureAirportName: "首都国际机场",
      arrivalAirportName: "虹桥国际机场",
      ...flightOverrides,
    }] }],
  }] } }, pageUrl);
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

test("a response for another date or missing date cannot become the requested day's fare", () => {
  const price = { cabin: "Y", adultPrice: 450, adultTax: 50 };
  for (const departureDateTime of ["2026-10-21 08:00:00", "08:00:00", undefined]) {
    assert.equal(normalize(price, { departureDateTime }).length, 0);
  }
  assert.equal(normalize(price, {}, "https://flights.ctrip.com/online/list/oneway-pek-sha?cabin=y").length, 0);
  assert.equal(normalize(price, { arrivalDateTime: "2026-10-19 10:20:00" }).length, 0);
  const [overnight] = normalize(price, { arrivalDateTime: "2026-10-21 10:20:00" });
  assert.match(overnight.cardText, /\+1天/);
});

test("retains selected price eligibility and prefers an available unrestricted product", () => {
  const conditional = { cabin: "Y", adultPrice: 450, adultTax: 50, productName: "新客专享" };
  const [restricted] = normalize(conditional);
  assert.match(restricted.cardText, /新客/);
  assert.match(restricted.cardText, /专享/);
  const [publicFare] = normalize([conditional, { cabin: "Y", adultPrice: 550, adultTax: 50 }]);
  assert.equal(publicFare.priceText, "¥600");
  assert.doesNotMatch(publicFare.cardText, /新客|专享/);
});

test("structured evidence preserves flight stopovers and restrictions without any DOM card", () => {
  const price = { cabin: "Y", adultPrice: 450, adultTax: 50 };
  for (const evidence of [{ stopDescription: "经停武汉" }, { stopCount: 1 }, { stopCount: "2" }, { stopInfo: { description: "停留45分钟" } }]) {
    const [card] = normalize(price, evidence);
    assert.match(card.cardText, /经停/);
  }
  const [nonstop] = normalize(price, { stopCount: 0, stopDescription: "无经停 0次中转" });
  assert.doesNotMatch(nonstop.cardText, /经停|中转/);
  const [restricted] = normalize(price, { fareNotice: "会员专享" });
  assert.match(restricted.cardText, /会员.*专享/);
});
