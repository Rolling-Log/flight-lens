import { z } from "zod";

const optionalNonEmpty = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const portNumber = z.coerce.number().int().min(1).max(65535);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().default("0.0.0.0"),
  PORT: portNumber.optional(),
  API_PORT: portNumber.default(4000),
  WEB_ORIGINS: z.string().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: optionalNonEmpty,
  OPENAI_INTENT_PARSER_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  OPENAI_API_KEY: optionalNonEmpty,
  OPENAI_MODEL: z.string().trim().min(1).default("gpt-5.6-luna"),
  SKYSCANNER_API_KEY: optionalNonEmpty,
  SKYSCANNER_BASE_URL: z
    .string()
    .url()
    .default("https://partners.api.skyscanner.net"),
  SERPAPI_API_KEY: optionalNonEmpty,
  SERPAPI_BASE_URL: z.string().url().default("https://serpapi.com"),
  AMADEUS_CLIENT_ID: optionalNonEmpty,
  AMADEUS_CLIENT_SECRET: optionalNonEmpty,
  AMADEUS_BASE_URL: z.string().url().default("https://test.api.amadeus.com"),
  DUFFEL_ACCESS_TOKEN: optionalNonEmpty,
  DUFFEL_BASE_URL: z.string().url().default("https://api.duffel.com"),
  // Netlify Free functions stop at 30 seconds. Leave enough time to normalize,
  // persist audit data, and return a transparent timeout response.
  CONNECTOR_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(25_000),
  CONNECTOR_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),
  CONNECTOR_CACHE_TTL_MS: z.coerce.number().int().min(0).max(300_000).default(60_000),
  CONNECTOR_STALE_IF_ERROR_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(300_000)
    .default(300_000),
});

export type ApiConfig = {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  webOrigins: string[];
  logLevel: string;
  databaseUrl?: string;
  openaiIntentParserEnabled: boolean;
  openaiApiKey?: string;
  openaiModel: string;
  connectorTimeoutMs: number;
  connectorMaxRetries?: number;
  connectorCacheTtlMs?: number;
  connectorStaleIfErrorMs?: number;
  connectors: {
    skyscannerApiKey?: string;
    skyscannerBaseUrl: string;
    serpApiKey?: string;
    serpApiBaseUrl: string;
    amadeusClientId?: string;
    amadeusClientSecret?: string;
    amadeusBaseUrl: string;
    duffelAccessToken?: string;
    duffelBaseUrl: string;
  };
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = envSchema.parse(environment);
  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.API_HOST,
    port: parsed.PORT ?? parsed.API_PORT,
    webOrigins: parsed.WEB_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
    logLevel: parsed.LOG_LEVEL,
    ...(parsed.DATABASE_URL ? { databaseUrl: parsed.DATABASE_URL } : {}),
    openaiIntentParserEnabled: parsed.OPENAI_INTENT_PARSER_ENABLED,
    ...(parsed.OPENAI_API_KEY ? { openaiApiKey: parsed.OPENAI_API_KEY } : {}),
    openaiModel: parsed.OPENAI_MODEL,
    connectorTimeoutMs: parsed.CONNECTOR_TIMEOUT_MS,
    connectorMaxRetries: parsed.CONNECTOR_MAX_RETRIES,
    connectorCacheTtlMs: parsed.CONNECTOR_CACHE_TTL_MS,
    connectorStaleIfErrorMs: parsed.CONNECTOR_STALE_IF_ERROR_MS,
    connectors: {
      ...(parsed.SKYSCANNER_API_KEY
        ? { skyscannerApiKey: parsed.SKYSCANNER_API_KEY }
        : {}),
      skyscannerBaseUrl: parsed.SKYSCANNER_BASE_URL,
      ...(parsed.SERPAPI_API_KEY ? { serpApiKey: parsed.SERPAPI_API_KEY } : {}),
      serpApiBaseUrl: parsed.SERPAPI_BASE_URL,
      ...(parsed.AMADEUS_CLIENT_ID ? { amadeusClientId: parsed.AMADEUS_CLIENT_ID } : {}),
      ...(parsed.AMADEUS_CLIENT_SECRET
        ? { amadeusClientSecret: parsed.AMADEUS_CLIENT_SECRET }
        : {}),
      amadeusBaseUrl: parsed.AMADEUS_BASE_URL,
      ...(parsed.DUFFEL_ACCESS_TOKEN ? { duffelAccessToken: parsed.DUFFEL_ACCESS_TOKEN } : {}),
      duffelBaseUrl: parsed.DUFFEL_BASE_URL,
    },
  };
}
