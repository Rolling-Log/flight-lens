import { z } from "zod";

const optionalNonEmpty = z.string().trim().min(1).optional();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGINS: z.string().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: optionalNonEmpty,
  OPENAI_API_KEY: optionalNonEmpty,
  OPENAI_MODEL: z.string().trim().min(1).default("gpt-5.6-luna"),
  AMADEUS_CLIENT_ID: optionalNonEmpty,
  AMADEUS_CLIENT_SECRET: optionalNonEmpty,
  AMADEUS_BASE_URL: z.string().url().default("https://test.api.amadeus.com"),
  DUFFEL_ACCESS_TOKEN: optionalNonEmpty,
  DUFFEL_BASE_URL: z.string().url().default("https://api.duffel.com"),
  CONNECTOR_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(12_000),
});

export type ApiConfig = {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  webOrigins: string[];
  logLevel: string;
  databaseUrl?: string;
  openaiApiKey?: string;
  openaiModel: string;
  connectorTimeoutMs: number;
  connectors: {
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
    port: parsed.API_PORT,
    webOrigins: parsed.WEB_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
    logLevel: parsed.LOG_LEVEL,
    ...(parsed.DATABASE_URL ? { databaseUrl: parsed.DATABASE_URL } : {}),
    ...(parsed.OPENAI_API_KEY ? { openaiApiKey: parsed.OPENAI_API_KEY } : {}),
    openaiModel: parsed.OPENAI_MODEL,
    connectorTimeoutMs: parsed.CONNECTOR_TIMEOUT_MS,
    connectors: {
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
