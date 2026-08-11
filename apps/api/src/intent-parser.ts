import {
  intentParseResponseSchema,
  searchIntentDraftSchema,
  searchIntentSchema,
  type IntentParseResponse,
  type SearchIntentDraft,
} from "@flight-lens/contracts";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

const modelDraftSchema = z.object({
  tripType: z.enum(["one_way", "round_trip"]),
  originCode: z.string().length(3).nullable(),
  destinationCode: z.string().length(3).nullable(),
  departureDate: z.string().nullable(),
  returnDate: z.string().nullable(),
  flexibleDays: z.number().int().min(0).max(3),
  adults: z.number().int().min(1).max(9),
  cabin: z.enum(["economy", "premium_economy", "business", "first"]),
  budgetAmountCny: z.number().int().positive().nullable(),
  departureTimeEarliest: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  departureTimeLatest: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  directOnly: z.boolean(),
  maxStops: z.number().int().min(0).max(2),
  avoidRedEye: z.boolean(),
  minimumCheckedBaggageKg: z.number().int().min(0).max(46),
  includeNearbyAirports: z.boolean(),
  assumptions: z.array(z.string()),
  pendingQuestions: z.array(z.string()),
});

export interface IntentParser {
  parse(text: string): Promise<IntentParseResponse>;
}

type ParserIdentity = IntentParseResponse["parser"];
type Now = () => Date;

function responseFromDraft(
  input: SearchIntentDraft,
  parser: ParserIdentity,
  explicitFields: string[] = [],
): IntentParseResponse {
  const draft = searchIntentDraftSchema.parse({
    ...input,
    originCode: input.originCode?.toUpperCase() ?? null,
    destinationCode: input.destinationCode?.toUpperCase() ?? null,
  });
  const candidate =
    draft.originCode && draft.destinationCode && draft.departureDate
      ? searchIntentSchema.safeParse({
          schemaVersion: "1",
          tripType: draft.tripType,
          origin: { kind: "airport", code: draft.originCode },
          destination: { kind: "airport", code: draft.destinationCode },
          departureDate: draft.departureDate,
          returnDate: draft.returnDate ?? undefined,
          flexibleDays: draft.flexibleDays,
          adults: draft.adults,
          cabin: draft.cabin,
          budget: draft.budgetAmountCny
            ? { amountMinor: draft.budgetAmountCny * 100, currency: "CNY" }
            : undefined,
          departureTime:
            draft.departureTimeEarliest || draft.departureTimeLatest
              ? {
                  ...(draft.departureTimeEarliest
                    ? { earliest: draft.departureTimeEarliest }
                    : {}),
                  ...(draft.departureTimeLatest
                    ? { latest: draft.departureTimeLatest }
                    : {}),
                }
              : undefined,
          directOnly: draft.directOnly,
          maxStops: draft.maxStops,
          avoidRedEye: draft.avoidRedEye,
          minimumCheckedBaggageKg: draft.minimumCheckedBaggageKg,
          includeNearbyAirports: draft.includeNearbyAirports,
          explicitFields,
          inferredFields: draft.assumptions.map((reason, index) => ({
            path: `assumption.${index}`,
            value: true,
            confidence: 0.7,
            reason,
          })),
          pendingQuestions: draft.pendingQuestions,
        })
      : null;

  const intent = candidate?.success ? candidate.data : null;
  return intentParseResponseSchema.parse({
    ready: Boolean(intent) && draft.pendingQuestions.length === 0,
    draft,
    intent,
    parser,
  });
}

export class OpenAIIntentParser implements IntentParser {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly now: Now = () => new Date(),
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async parse(text: string): Promise<IntentParseResponse> {
    const response = await this.client.responses.parse({
      model: this.model,
      store: false,
      input: [
        {
          role: "system",
          content: [
            "你是航班检索条件解析器，只提取用户明确表达或可保守推断的条件。",
            "机场和城市必须输出 IATA 三字码；不确定时输出 null 并提出问题。",
            "相对日期必须以当前中国时区日期为基准转成 YYYY-MM-DD。",
            "用户表达早班、晚班或明确时间范围时，用 24 小时 HH:MM 填入出发时间上下界；没有说明时为 null。",
            "用户没有说明时：1 名成人、经济舱、最多 1 次中转、日期不浮动、无行李要求。",
            "directOnly 为 true 时 maxStops 必须为 0。",
            "不得生成票价、航班、平台或搜索结果。所有推断写入 assumptions。",
          ].join("\n"),
        },
        {
          role: "user",
          content: `当前中国时区日期：${chinaDate(this.now())}\n用户需求：${text}`,
        },
      ],
      text: {
        format: zodTextFormat(modelDraftSchema, "flight_search_intent_draft"),
      },
    });

    if (!response.output_parsed) {
      throw new Error("The model did not return a structured SearchIntent draft.");
    }

    return responseFromDraft(
      response.output_parsed,
      {
        kind: "openai_structured_output",
        model: this.model,
      },
    );
  }
}

type LocationAlias = {
  alias: string;
  code: string;
  assumption?: string;
};

const locationAliases: LocationAlias[] = [
  { alias: "上海浦东", code: "PVG" },
  { alias: "浦东机场", code: "PVG" },
  { alias: "上海虹桥", code: "SHA" },
  { alias: "虹桥机场", code: "SHA" },
  { alias: "北京首都", code: "PEK" },
  { alias: "首都机场", code: "PEK" },
  { alias: "北京大兴", code: "PKX" },
  { alias: "大兴机场", code: "PKX" },
  { alias: "成都天府", code: "TFU" },
  { alias: "成都双流", code: "CTU" },
  { alias: "东京成田", code: "NRT" },
  { alias: "东京羽田", code: "HND" },
  { alias: "纽约肯尼迪", code: "JFK" },
  { alias: "上海", code: "PVG", assumption: "“上海”按浦东机场 PVG 解析，可在表单修改为虹桥 SHA。" },
  { alias: "北京", code: "PEK", assumption: "“北京”按首都机场 PEK 解析，可在表单修改为大兴 PKX。" },
  { alias: "广州", code: "CAN" },
  { alias: "深圳", code: "SZX" },
  { alias: "成都", code: "TFU", assumption: "“成都”按天府机场 TFU 解析，可在表单修改为双流 CTU。" },
  { alias: "重庆", code: "CKG" },
  { alias: "西安", code: "XIY" },
  { alias: "杭州", code: "HGH" },
  { alias: "南京", code: "NKG" },
  { alias: "武汉", code: "WUH" },
  { alias: "长沙", code: "CSX" },
  { alias: "厦门", code: "XMN" },
  { alias: "昆明", code: "KMG" },
  { alias: "青岛", code: "TAO" },
  { alias: "三亚", code: "SYX" },
  { alias: "海口", code: "HAK" },
  { alias: "乌鲁木齐", code: "URC" },
  { alias: "哈尔滨", code: "HRB" },
  { alias: "沈阳", code: "SHE" },
  { alias: "大连", code: "DLC" },
  { alias: "天津", code: "TSN" },
  { alias: "郑州", code: "CGO" },
  { alias: "济南", code: "TNA" },
  { alias: "福州", code: "FOC" },
  { alias: "南宁", code: "NNG" },
  { alias: "香港", code: "HKG" },
  { alias: "澳门", code: "MFM" },
  { alias: "台北", code: "TPE" },
  { alias: "东京", code: "NRT", assumption: "“东京”按成田机场 NRT 解析，可在表单修改为羽田 HND。" },
  { alias: "大阪", code: "KIX" },
  { alias: "首尔", code: "ICN" },
  { alias: "新加坡", code: "SIN" },
  { alias: "曼谷", code: "BKK" },
  { alias: "吉隆坡", code: "KUL" },
  { alias: "伦敦", code: "LHR" },
  { alias: "巴黎", code: "CDG" },
  { alias: "纽约", code: "JFK" },
  { alias: "洛杉矶", code: "LAX" },
  { alias: "悉尼", code: "SYD" },
  { alias: "墨尔本", code: "MEL" },
];

type LocationMention = LocationAlias & { index: number };

function locationsIn(text: string): LocationMention[] {
  const mentions: LocationMention[] = [];
  for (const item of locationAliases) {
    const index = text.indexOf(item.alias);
    if (index >= 0) mentions.push({ ...item, index });
  }
  for (const match of text.toUpperCase().matchAll(/\b[A-Z]{3}\b/g)) {
    if (match.index !== undefined) {
      mentions.push({ alias: match[0], code: match[0], index: match.index });
    }
  }
  const selected: LocationMention[] = [];
  for (const mention of mentions.sort(
    (left, right) => left.index - right.index || right.alias.length - left.alias.length,
  )) {
    if (!selected.some((value) => value.code === mention.code)) selected.push(mention);
  }
  return selected;
}

function isoDate(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function utcDate(year: number, month: number, day: number): Date | null {
  const value = new Date(Date.UTC(year, month - 1, day, 12));
  return value.getUTCFullYear() === year &&
    value.getUTCMonth() === month - 1 &&
    value.getUTCDate() === day
    ? value
    : null;
}

function addDays(date: Date, days: number): Date {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value;
}

function weekdayNumber(value: string): number {
  return value === "日" || value === "天"
    ? 7
    : "一二三四五六".indexOf(value) + 1;
}

function datesIn(text: string, today: Date): Date[] {
  const values: Array<{ index: number; date: Date }> = [];
  const occupied = new Set<number>();
  for (const match of text.matchAll(/(\d{4})[年./-](\d{1,2})[月./-](\d{1,2})日?/g)) {
    const value = utcDate(Number(match[1]), Number(match[2]), Number(match[3]));
    if (value && match.index !== undefined) {
      values.push({ index: match.index, date: value });
      for (let index = match.index; index < match.index + match[0].length; index += 1) {
        occupied.add(index);
      }
    }
  }
  for (const match of text.matchAll(/(\d{1,2})月(\d{1,2})[日号]?/g)) {
    if (match.index === undefined || occupied.has(match.index)) continue;
    const year = today.getUTCFullYear();
    let value = utcDate(year, Number(match[1]), Number(match[2]));
    if (value && value < today) value = utcDate(year + 1, Number(match[1]), Number(match[2]));
    if (value) values.push({ index: match.index, date: value });
  }
  const tomorrowIndex = text.indexOf("明天");
  if (tomorrowIndex >= 0) values.push({ index: tomorrowIndex, date: addDays(today, 1) });
  const dayAfterIndex = text.indexOf("后天");
  if (dayAfterIndex >= 0) values.push({ index: dayAfterIndex, date: addDays(today, 2) });
  for (const match of text.matchAll(/下个月(\d{1,2})[日号]/g)) {
    if (match.index === undefined) continue;
    const nextMonth = today.getUTCMonth() === 11 ? 1 : today.getUTCMonth() + 2;
    const year = today.getUTCMonth() === 11
      ? today.getUTCFullYear() + 1
      : today.getUTCFullYear();
    const value = utcDate(year, nextMonth, Number(match[1]));
    if (value) values.push({ index: match.index, date: value });
  }
  let nextWeekDeparture: Date | undefined;
  for (const match of text.matchAll(/下周([一二三四五六日天])/g)) {
    if (match.index === undefined) continue;
    const todayWeekday = today.getUTCDay() === 0 ? 7 : today.getUTCDay();
    const nextMonday = addDays(today, 8 - todayWeekday);
    const value = addDays(nextMonday, weekdayNumber(match[1]!) - 1);
    nextWeekDeparture ??= value;
    values.push({ index: match.index, date: value });
  }
  if (nextWeekDeparture) {
    for (const match of text.matchAll(/(?:周|星期)([一二三四五六日天])(?:回来|返程|回)/g)) {
      if (match.index === undefined || /下周/.test(match[0])) continue;
      const targetWeekday = weekdayNumber(match[1]!);
      const departureWeekday =
        nextWeekDeparture.getUTCDay() === 0 ? 7 : nextWeekDeparture.getUTCDay();
      const offset = (targetWeekday - departureWeekday + 7) % 7 || 7;
      values.push({ index: match.index, date: addDays(nextWeekDeparture, offset) });
    }
  }
  return values
    .sort((left, right) => left.index - right.index)
    .filter((value, index, all) =>
      index === all.findIndex((candidate) => isoDate(candidate.date) === isoDate(value.date)),
    )
    .map((value) => value.date);
}

function numberFromText(value: string | undefined): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const chinese = "一二三四五六七八九";
  const index = chinese.indexOf(value);
  return index >= 0 ? index + 1 : undefined;
}

export class LocalChineseIntentParser implements IntentParser {
  constructor(private readonly now: Now = () => new Date()) {}

  async parse(text: string): Promise<IntentParseResponse> {
    const locations = locationsIn(text);
    const todayIso = chinaDate(this.now());
    const [todayYear, todayMonth, todayDay] = todayIso.split("-").map(Number);
    const today = utcDate(todayYear!, todayMonth!, todayDay!)!;
    const dates = datesIn(text, today);
    const departure = dates[0];
    const durationMatch = /(?:往返|玩|停留|待)(\d{1,2})天/.exec(text);
    const roundTrip =
      Boolean(dates[1]) ||
      /往返|来回|返程|回程|回来|返回/.test(text) ||
      Boolean(durationMatch && !/单程/.test(text));
    const returnDate = dates[1] ??
      (roundTrip && departure && durationMatch
        ? addDays(departure, Number(durationMatch[1]))
        : undefined);
    const adultMatch = /([1-9一二三四五六七八九])\s*(?:名|位|个)?(?:成人|人|个人)/.exec(text);
    const adults = numberFromText(adultMatch?.[1]) ?? 1;
    const cabin = /头等舱/.test(text)
      ? "first"
      : /商务舱|公务舱/.test(text)
        ? "business"
        : /超级经济舱|高端经济舱|豪华经济舱/.test(text)
          ? "premium_economy"
          : "economy";
    const cabinExplicit = /经济舱|头等舱|商务舱|公务舱/.test(text);
    const budgetMatch =
      /(?:预算|不超过|最多|控制在)\s*(\d{2,6})\s*元?/.exec(text) ??
      /(\d{2,6})\s*元(?:以内|以下)/.exec(text);
    const flexibleMatch = /(?:前后|±|浮动)\s*([1-3])\s*天/.exec(text);
    const stopMatch = /(?:最多|允许)\s*([0-2一二])\s*次中转/.exec(text);
    const directOnly =
      /直飞|直达|不中转/.test(text) &&
      !/不要求直飞|无需直飞|接受中转/.test(text);
    const baggageMatch =
      /(?:托运(?:行李)?).{0,8}?(\d{1,2})\s*(?:kg|公斤|千克)/i.exec(text) ??
      /(\d{1,2})\s*(?:kg|公斤|千克).{0,8}?(?:托运(?:行李)?)/i.exec(text);
    const checkedBaggageRequested = /(?:含|带|需要|必须有?).{0,4}托运(?:行李)?/.test(text);
    const minimumCheckedBaggageKg = baggageMatch
      ? Number(baggageMatch[1])
      : checkedBaggageRequested
        ? 23
        : 0;
    const timeRange = /(\d{1,2})(?::|点)(\d{2})?\s*(?:到|至|-)\s*(\d{1,2})(?::|点)(\d{2})?/.exec(text);
    const timePreset =
      /早班|早上/.test(text)
        ? ["06:00", "10:00"]
        : /上午/.test(text)
          ? ["06:00", "12:00"]
          : /下午/.test(text)
            ? ["12:00", "18:00"]
            : /晚上|晚班/.test(text)
              ? ["18:00", "23:59"]
              : null;
    const earliest = timeRange
      ? `${timeRange[1]!.padStart(2, "0")}:${(timeRange[2] ?? "00").padStart(2, "0")}`
      : timePreset?.[0] ?? null;
    const latest = timeRange
      ? `${timeRange[3]!.padStart(2, "0")}:${(timeRange[4] ?? "00").padStart(2, "0")}`
      : timePreset?.[1] ?? null;
    const pendingQuestions: string[] = [];
    if (!locations[0]) pendingQuestions.push("请确认出发城市或机场。");
    if (!locations[1]) pendingQuestions.push("请确认目的城市或机场。");
    if (!departure) {
      pendingQuestions.push(
        /下个月/.test(text)
          ? "请确认下个月的具体出发日期。"
          : "请确认具体出发日期。",
      );
    } else if (isoDate(departure) < todayIso) {
      pendingQuestions.push("出发日期已经过去，请确认新的日期。");
    }
    if (roundTrip && !returnDate) pendingQuestions.push("请确认返程日期或旅行天数。");
    const assumptions = locations.flatMap((location) =>
      location.assumption ? [location.assumption] : [],
    );
    if (!adultMatch) assumptions.push("未说明乘客人数，按 1 名成人解析。");
    if (!cabinExplicit) assumptions.push("未说明舱位，按经济舱解析。");
    if (!dates[1] && !/单程|往返|来回|返程|回程|回来|返回/.test(text)) {
      assumptions.push(
        durationMatch
          ? "根据旅行天数按往返解析。"
          : "未说明往返，按单程解析。",
      );
    }
    if (!directOnly && !stopMatch) assumptions.push("未说明中转要求，按最多 1 次中转解析。");
    if (checkedBaggageRequested && !baggageMatch) {
      assumptions.push("要求托运行李但未说明重量，按至少 23kg 解析，可在表单修改。");
    }

    const explicitFields = [
      ...(locations[0] ? ["origin"] : []),
      ...(locations[1] ? ["destination"] : []),
      ...(departure ? ["departureDate"] : []),
      ...(returnDate ? ["returnDate"] : []),
      ...(adultMatch ? ["adults"] : []),
      ...(cabinExplicit ? ["cabin"] : []),
      ...(budgetMatch ? ["budget"] : []),
      ...(flexibleMatch ? ["flexibleDays"] : []),
      ...(directOnly || stopMatch ? ["maxStops"] : []),
      ...(baggageMatch || checkedBaggageRequested ? ["minimumCheckedBaggageKg"] : []),
      ...(earliest || latest ? ["departureTime"] : []),
    ];

    return responseFromDraft(
      {
        tripType: roundTrip ? "round_trip" : "one_way",
        originCode: locations[0]?.code ?? null,
        destinationCode: locations[1]?.code ?? null,
        departureDate: departure ? isoDate(departure) : null,
        returnDate: returnDate ? isoDate(returnDate) : null,
        flexibleDays: flexibleMatch ? Number(flexibleMatch[1]) : 0,
        adults,
        cabin,
        budgetAmountCny: budgetMatch ? Number(budgetMatch[1]) : null,
        departureTimeEarliest: earliest,
        departureTimeLatest: latest,
        directOnly,
        maxStops: directOnly ? 0 : numberFromText(stopMatch?.[1]) ?? 1,
        avoidRedEye: /(?:不要|避免|避开|拒绝|不想坐|不坐|别坐).{0,4}红眼/.test(text),
        minimumCheckedBaggageKg,
        includeNearbyAirports: /附近机场|周边机场/.test(text),
        assumptions,
        pendingQuestions,
      },
      { kind: "local_deterministic_zh", model: "local-zh-v1" },
      explicitFields,
    );
  }
}

export class FallbackIntentParser implements IntentParser {
  constructor(
    private readonly primary: IntentParser,
    private readonly fallback: IntentParser,
  ) {}

  async parse(text: string): Promise<IntentParseResponse> {
    try {
      return await this.primary.parse(text);
    } catch {
      return this.fallback.parse(text);
    }
  }
}

function chinaDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
