import assert from "node:assert/strict";
import test from "node:test";
import { LocalChineseIntentParser } from "../src/intent-parser.js";

const fixedNow = () => new Date("2026-07-31T04:00:00.000Z");

test("parses a complete Chinese round-trip request without an external model", async () => {
  const parser = new LocalChineseIntentParser(fixedNow);
  const result = await parser.parse(
    "2026年8月24日上海去东京，往返5天，2个人，预算3000元，不要红眼，直飞，托运行李23kg，前后3天。",
  );

  assert.equal(result.ready, true);
  assert.equal(result.parser.kind, "local_deterministic_zh");
  assert.equal(result.intent?.origin.code, "PVG");
  assert.equal(result.intent?.destination.code, "NRT");
  assert.equal(result.intent?.departureDate, "2026-08-24");
  assert.equal(result.intent?.returnDate, "2026-08-29");
  assert.equal(result.intent?.adults, 2);
  assert.equal(result.intent?.budget?.amountMinor, 300_000);
  assert.equal(result.intent?.directOnly, true);
  assert.equal(result.intent?.avoidRedEye, true);
  assert.equal(result.intent?.minimumCheckedBaggageKg, 23);
  assert.equal(result.intent?.flexibleDays, 3);
});

test("parses next-week weekday and a later return weekday deterministically", async () => {
  const parser = new LocalChineseIntentParser(fixedNow);
  const result = await parser.parse(
    "下周五北京到成都，周日回来，2个成人，早班机优先，含托运行李，预算2500元。",
  );

  assert.equal(result.ready, true);
  assert.equal(result.intent?.departureDate, "2026-08-07");
  assert.equal(result.intent?.returnDate, "2026-08-09");
  assert.deepEqual(result.intent?.departureTime, {
    earliest: "06:00",
    latest: "10:00",
  });
  assert.equal(result.intent?.minimumCheckedBaggageKg, 23);
  assert.equal(
    result.draft.assumptions.some((value) => value.includes("未说明重量")),
    true,
  );
});

test("parses an explicitly requested cabin class", async () => {
  const parser = new LocalChineseIntentParser(fixedNow);
  const result = await parser.parse("2026-08-24 上海到北京，单程，2位成人，商务舱。");

  assert.equal(result.ready, true);
  assert.equal(result.intent?.cabin, "business");
  assert.equal(result.intent?.adults, 2);
  assert.equal(result.intent?.explicitFields.includes("cabin"), true);
});

test("asks for an exact date instead of inventing one for a vague month", async () => {
  const parser = new LocalChineseIntentParser(fixedNow);
  const result = await parser.parse("下个月上海飞东京，单程，1位成人。");

  assert.equal(result.ready, false);
  assert.equal(result.intent, null);
  assert.equal(
    result.draft.pendingQuestions.includes("请确认下个月的具体出发日期。"),
    true,
  );
  assert.equal(result.draft.originCode, "PVG");
  assert.equal(result.draft.destinationCode, "NRT");
});

test("accepts explicit IATA codes and never creates price results", async () => {
  const parser = new LocalChineseIntentParser(fixedNow);
  const result = await parser.parse("PVG到NRT，2026-08-24单程。");

  assert.equal(result.ready, true);
  assert.equal(result.intent?.origin.code, "PVG");
  assert.equal(result.intent?.destination.code, "NRT");
  assert.equal("offers" in result, false);
});

test("treats a second ISO date followed by 返回 as a round trip", async () => {
  const parser = new LocalChineseIntentParser(fixedNow);
  const result = await parser.parse(
    "2026-08-24 上海去东京，2026-08-29 返回，1 位成人，经济舱。",
  );

  assert.equal(result.ready, true);
  assert.equal(result.intent?.tripType, "round_trip");
  assert.equal(result.intent?.departureDate, "2026-08-24");
  assert.equal(result.intent?.returnDate, "2026-08-29");
});

test("infers a return trip from an explicit stay length and recognizes natural red-eye wording", async () => {
  const parser = new LocalChineseIntentParser(fixedNow);
  const result = await parser.parse(
    "2026年8月24日北京去东京，玩5天，预算3000元，不想坐红眼航班。",
  );

  assert.equal(result.ready, true);
  assert.equal(result.intent?.tripType, "round_trip");
  assert.equal(result.intent?.returnDate, "2026-08-29");
  assert.equal(result.intent?.avoidRedEye, true);
  assert.equal(
    result.draft.assumptions.includes("根据旅行天数按往返解析。"),
    true,
  );
});
