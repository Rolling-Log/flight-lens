import { z } from "zod";

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const localDateTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/);
export const currencySchema = z.string().length(3).transform((value) => value.toUpperCase());

export const airportRefSchema = z.object({
  kind: z.enum(["airport", "city"]),
  code: z.string().min(3).max(3).transform((value) => value.toUpperCase()),
  name: z.string().min(1).optional(),
});

export const timeWindowSchema = z.object({
  earliest: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  latest: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

export const inferredFieldSchema = z.object({
  path: z.string().min(1),
  value: z.unknown(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
});

export const searchIntentSchema = z
  .object({
    schemaVersion: z.literal("1"),
    tripType: z.enum(["one_way", "round_trip"]),
    origin: airportRefSchema,
    destination: airportRefSchema,
    departureDate: isoDateSchema,
    returnDate: isoDateSchema.optional(),
    flexibleDays: z.number().int().min(0).max(3).default(0),
    adults: z.number().int().min(1).max(9).default(1),
    cabin: z.literal("economy").default("economy"),
    budget: z
      .object({
        amountMinor: z.number().int().positive(),
        currency: currencySchema,
      })
      .optional(),
    departureTime: timeWindowSchema.optional(),
    directOnly: z.boolean().default(false),
    maxStops: z.number().int().min(0).max(2).default(1),
    avoidRedEye: z.boolean().default(false),
    minimumCheckedBaggageKg: z.number().int().min(0).max(46).default(0),
    includeNearbyAirports: z.boolean().default(false),
    explicitFields: z.array(z.string()).default([]),
    inferredFields: z.array(inferredFieldSchema).default([]),
    pendingQuestions: z.array(z.string()).default([]),
  })
  .superRefine((value, context) => {
    if (value.tripType === "round_trip" && !value.returnDate) {
      context.addIssue({
        code: "custom",
        path: ["returnDate"],
        message: "Round trips require a return date.",
      });
    }
    if (value.tripType === "one_way" && value.returnDate) {
      context.addIssue({
        code: "custom",
        path: ["returnDate"],
        message: "One-way trips cannot contain a return date.",
      });
    }
    if (value.origin.code === value.destination.code) {
      context.addIssue({
        code: "custom",
        path: ["destination"],
        message: "Origin and destination must differ.",
      });
    }
    if (value.returnDate && value.returnDate <= value.departureDate) {
      context.addIssue({
        code: "custom",
        path: ["returnDate"],
        message: "Return date must be after departure date.",
      });
    }
    if (
      value.departureTime?.earliest &&
      value.departureTime.latest &&
      value.departureTime.earliest > value.departureTime.latest
    ) {
      context.addIssue({
        code: "custom",
        path: ["departureTime"],
        message: "Departure time window must be chronological.",
      });
    }
    if (value.directOnly && value.maxStops !== 0) {
      context.addIssue({
        code: "custom",
        path: ["maxStops"],
        message: "Direct-only searches must set maximum stops to zero.",
      });
    }
  });

export type SearchIntent = z.infer<typeof searchIntentSchema>;

export const searchIntentDraftSchema = z.object({
  tripType: z.enum(["one_way", "round_trip"]),
  originCode: z.string().length(3).nullable(),
  destinationCode: z.string().length(3).nullable(),
  departureDate: isoDateSchema.nullable(),
  returnDate: isoDateSchema.nullable(),
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

export type SearchIntentDraft = z.infer<typeof searchIntentDraftSchema>;

export const intentParseResponseSchema = z.object({
  ready: z.boolean(),
  draft: searchIntentDraftSchema,
  intent: searchIntentSchema.nullable(),
  parser: z.object({
    kind: z.enum(["openai_structured_output", "local_deterministic_zh"]),
    model: z.string(),
  }),
});

export type IntentParseResponse = z.infer<typeof intentParseResponseSchema>;

export const moneySchema = z.object({
  amountMinor: z.number().int().nonnegative(),
  currency: currencySchema,
});

export const priceComponentSchema = moneySchema.extend({
  kind: z.enum(["base", "tax", "fuel", "baggage", "payment", "required_service", "discount"]),
  label: z.string().min(1),
  required: z.boolean(),
});

export const baggageAllowanceSchema = z.object({
  type: z.enum(["cabin", "checked"]),
  quantity: z.number().int().nonnegative().optional(),
  weightKg: z.number().nonnegative().optional(),
  included: z.boolean(),
});

export const flightSegmentSchema = z.object({
  id: z.string().min(1),
  legIndex: z.number().int().nonnegative(),
  marketingCarrier: z.string().min(2).max(3),
  operatingCarrier: z.string().min(2).max(3).optional(),
  flightNumber: z.string().min(1),
  origin: airportRefSchema,
  destination: airportRefSchema,
  departureAt: z.union([isoDateTimeSchema, localDateTimeSchema]),
  arrivalAt: z.union([isoDateTimeSchema, localDateTimeSchema]),
  departureTimeZone: z.string().min(1).optional(),
  arrivalTimeZone: z.string().min(1).optional(),
  durationMinutes: z.number().int().positive(),
  aircraftCode: z.string().optional(),
});

export const flightLegSchema = z.object({
  id: z.string().min(1),
  segmentIds: z.array(z.string().min(1)).min(1),
  origin: airportRefSchema,
  destination: airportRefSchema,
  departureAt: z.union([isoDateTimeSchema, localDateTimeSchema]),
  arrivalAt: z.union([isoDateTimeSchema, localDateTimeSchema]),
  durationMinutes: z.number().int().positive(),
  stopCount: z.number().int().nonnegative(),
});

export const sellerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["airline", "ota", "metasearch", "aggregator"]),
  deepLink: z.string().url().optional(),
  handoffPrecision: z.enum(["exact_offer", "search_results"]).optional(),
});

export const offerSchema = z.object({
  schemaVersion: z.literal("1"),
  id: z.string().min(1),
  sourceOfferId: z.string().min(1),
  connectorId: z.string().min(1),
  environment: z.enum(["demo", "sandbox", "production"]),
  seller: sellerSchema,
  legs: z.array(flightLegSchema).min(1),
  segments: z.array(flightSegmentSchema).min(1),
  priceComponents: z.array(priceComponentSchema).min(1),
  totalPrice: moneySchema,
  totalPriceCny: moneySchema.optional(),
  baggage: z.array(baggageAllowanceSchema).default([]),
  fareBrand: z.string().optional(),
  refundable: z.boolean().nullable(),
  changeable: z.boolean().nullable(),
  eligibility: z.array(z.string()).default([]),
  fetchedAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema.optional(),
  evidenceRef: z.string().optional(),
  comparable: z.boolean(),
  incomparabilityReasons: z.array(z.string()).default([]),
  qualityScore: z.number().min(0).max(100),
});

export type Offer = z.infer<typeof offerSchema>;

export const connectorStateSchema = z.enum([
  "success",
  "empty",
  "timeout",
  "rate_limited",
  "auth_error",
  "provider_error",
  "invalid_response",
  "unavailable",
]);

export const connectorReportSchema = z.object({
  connectorId: z.string(),
  connectorName: z.string(),
  state: connectorStateSchema,
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema,
  durationMs: z.number().int().nonnegative(),
  offerCount: z.number().int().nonnegative(),
  errorCode: z.string().optional(),
  retryable: z.boolean(),
  notes: z.array(z.string()).default([]),
});

export type ConnectorReport = z.infer<typeof connectorReportSchema>;

export const searchResponseSchema = z.object({
  requestId: z.string().uuid(),
  intent: searchIntentSchema,
  offers: z.array(offerSchema),
  connectorReports: z.array(connectorReportSchema),
  lowestComparableOfferId: z.string().nullable(),
  recommendedOfferId: z.string().nullable(),
  shortestOfferId: z.string().nullable(),
  fewestStopsOfferId: z.string().nullable(),
  bestBaggageOfferId: z.string().nullable(),
  mostFlexibleOfferId: z.string().nullable(),
  disclosure: z.object({
    plannedSources: z.number().int().nonnegative(),
    successfulSources: z.number().int().nonnegative(),
    failedSources: z.number().int().nonnegative(),
    timedOutSources: z.number().int().nonnegative(),
    statement: z.string(),
  }),
  audit: z.object({
    configured: z.boolean(),
    persisted: z.boolean(),
    errorCode: z.string().optional(),
  }),
});

export type SearchResponse = z.infer<typeof searchResponseSchema>;
