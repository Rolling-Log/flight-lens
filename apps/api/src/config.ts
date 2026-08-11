import { z } from "zod";

const optionalNonEmpty = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const portNumber = z.coerce.number().int().min(1).max(65535);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().default("::"),
  PORT: portNumber.optional(),
  API_PORT: portNumber.default(4000),
  WEB_ORIGINS: z.string().default("http://localhost:3000,http://127.0.0.1:3000"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: optionalNonEmpty,
  OPENAI_INTENT_PARSER_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  OPENAI_API_KEY: optionalNonEmpty,
  OPENAI_MODEL: z.string().trim().min(1).default("gpt-5.6-luna"),
  FLYAI_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  FLYAI_API_KEY: optionalNonEmpty,
  FLYAI_CLI_PATH: optionalNonEmpty,
  DOMESTIC_BROWSER_CONNECTORS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  BROWSER_EXECUTABLE_PATH: optionalNonEmpty,
  BROWSER_HEADLESS: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  BROWSER_PROXY_SERVER: optionalNonEmpty,
  BROWSER_NAVIGATION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(45_000)
    .default(16_000),
  FLIGHTAPI_API_KEY: optionalNonEmpty,
  FLIGHTAPI_BASE_URL: z.string().url().default("https://api.flightapi.io"),
  FLIGHTAPI_MAX_SEARCHES_PER_PROCESS: z.coerce.number().int().min(1).max(20).default(10),
  SKYSCANNER_API_KEY: optionalNonEmpty,
  SKYSCANNER_BASE_URL: z
    .string()
    .url()
    .default("https://partners.api.skyscanner.net"),
  SERPAPI_API_KEY: optionalNonEmpty,
  SERPAPI_BASE_URL: z.string().url().default("https://serpapi.com"),
  SERPAPI_MONTHLY_CREDIT_CAP: z.coerce.number().int().min(5).max(250).default(200),
  DUFFEL_ACCESS_TOKEN: optionalNonEmpty,
  DUFFEL_BASE_URL: z.string().url().default("https://api.duffel.com"),
  // Keep each request bounded even though Railway runs a long-lived process.
  CONNECTOR_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(20_000),
  AUDIT_TIMEOUT_MS: z.coerce.number().int().min(250).max(10_000).default(3_000),
  SEARCH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1_000).default(2),
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
  auditTimeoutMs: number;
  searchRateLimitMax?: number;
  connectorMaxRetries?: number;
  connectorCacheTtlMs?: number;
  connectorStaleIfErrorMs?: number;
  connectors: {
    flyAiEnabled?: boolean;
    flyAiApiKey?: string;
    flyAiCliPath?: string;
    browserOtaEnabled?: boolean;
    browserExecutablePath?: string;
    browserHeadless?: boolean;
    browserProxyServer?: string;
    browserNavigationTimeoutMs?: number;
    flightApiKey?: string;
    flightApiBaseUrl?: string;
    flightApiMaxSearchesPerProcess?: number;
    skyscannerApiKey?: string;
    skyscannerBaseUrl: string;
    serpApiKey?: string;
    serpApiBaseUrl: string;
    serpApiMonthlyCreditCap: number;
    amadeusBaseUrl?: string;
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
    auditTimeoutMs: parsed.AUDIT_TIMEOUT_MS,
    searchRateLimitMax: parsed.SEARCH_RATE_LIMIT_MAX,
    connectorMaxRetries: parsed.CONNECTOR_MAX_RETRIES,
    connectorCacheTtlMs: parsed.CONNECTOR_CACHE_TTL_MS,
    connectorStaleIfErrorMs: parsed.CONNECTOR_STALE_IF_ERROR_MS,
    connectors: {
      flyAiEnabled: parsed.FLYAI_ENABLED,
      ...(parsed.FLYAI_API_KEY ? { flyAiApiKey: parsed.FLYAI_API_KEY } : {}),
      ...(parsed.FLYAI_CLI_PATH ? { flyAiCliPath: parsed.FLYAI_CLI_PATH } : {}),
      browserOtaEnabled: parsed.DOMESTIC_BROWSER_CONNECTORS_ENABLED,
      ...(parsed.BROWSER_EXECUTABLE_PATH
        ? { browserExecutablePath: parsed.BROWSER_EXECUTABLE_PATH }
        : {}),
      browserHeadless: parsed.BROWSER_HEADLESS,
      ...(parsed.BROWSER_PROXY_SERVER
        ? { browserProxyServer: parsed.BROWSER_PROXY_SERVER }
        : {}),
      browserNavigationTimeoutMs: parsed.BROWSER_NAVIGATION_TIMEOUT_MS,
      ...(parsed.FLIGHTAPI_API_KEY ? { flightApiKey: parsed.FLIGHTAPI_API_KEY } : {}),
      flightApiBaseUrl: parsed.FLIGHTAPI_BASE_URL,
      flightApiMaxSearchesPerProcess: parsed.FLIGHTAPI_MAX_SEARCHES_PER_PROCESS,
      ...(parsed.SKYSCANNER_API_KEY
        ? { skyscannerApiKey: parsed.SKYSCANNER_API_KEY }
        : {}),
      skyscannerBaseUrl: parsed.SKYSCANNER_BASE_URL,
      ...(parsed.SERPAPI_API_KEY ? { serpApiKey: parsed.SERPAPI_API_KEY } : {}),
      serpApiBaseUrl: parsed.SERPAPI_BASE_URL,
      serpApiMonthlyCreditCap: parsed.SERPAPI_MONTHLY_CREDIT_CAP,
      ...(parsed.DUFFEL_ACCESS_TOKEN ? { duffelAccessToken: parsed.DUFFEL_ACCESS_TOKEN } : {}),
      duffelBaseUrl: parsed.DUFFEL_BASE_URL,
    },
  };
}
