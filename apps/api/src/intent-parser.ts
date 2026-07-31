import {
  intentParseResponseSchema,
  searchIntentDraftSchema,
  searchIntentSchema,
  type IntentParseResponse,
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

export class OpenAIIntentParser implements IntentParser {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
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
          content: `当前中国时区日期：${chinaDate()}\n用户需求：${text}`,
        },
      ],
      text: {
        format: zodTextFormat(modelDraftSchema, "flight_search_intent_draft"),
      },
    });

    if (!response.output_parsed) {
      throw new Error("The model did not return a structured SearchIntent draft.");
    }

    const draft = searchIntentDraftSchema.parse({
      ...response.output_parsed,
      originCode: response.output_parsed.originCode?.toUpperCase() ?? null,
      destinationCode: response.output_parsed.destinationCode?.toUpperCase() ?? null,
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
            cabin: "economy",
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
            explicitFields: [],
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
      parser: {
        kind: "openai_structured_output",
        model: this.model,
      },
    });
  }
}

function chinaDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
