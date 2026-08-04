import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import {
  createConnectorRegistry,
  executeConnector,
  type ConnectorExecutionPolicy,
  type FlightConnector,
} from "@flight-lens/connectors";
import {
  searchIntentSchema,
  searchResponseSchema,
  type ConnectorReport,
  type Offer,
  type SearchIntent,
  type SearchResponse,
} from "@flight-lens/contracts";
import { createSearchAuditStore } from "@flight-lens/database";
import {
  applyIntentConstraints,
  deduplicateOffers,
  disclosureStatement,
  rankByBestBaggage,
  rankByFewestStops,
  rankByLowestComparablePrice,
  rankRecommended,
  rankByRefundFlexibility,
  rankByShortestDuration,
  reviewOffers,
} from "@flight-lens/domain";
import Fastify, { type FastifyInstance } from "fastify";
import type { ApiConfig } from "./config.js";
import {
  FallbackIntentParser,
  LocalChineseIntentParser,
  OpenAIIntentParser,
  type IntentParser,
} from "./intent-parser.js";

type SearchAuditStore = {
  persist(payload: Parameters<ReturnType<typeof createSearchAuditStore>["persist"]>[0]): Promise<void>;
  close(): Promise<void>;
};

type BuildAppOptions = {
  config: ApiConfig;
  connectors?: FlightConnector[];
  auditStore?: SearchAuditStore | null;
  intentParser?: IntentParser | null;
  now?: () => Date;
};

class AuditPersistTimeoutError extends Error {
  constructor() {
    super("Search audit persistence exceeded its runtime budget.");
    this.name = "AuditPersistTimeoutError";
  }
}

async function persistAuditWithin(
  auditStore: SearchAuditStore,
  payload: Parameters<SearchAuditStore["persist"]>[0],
  timeoutMs: number,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      auditStore.persist(payload),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new AuditPersistTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function coverage(reports: ConnectorReport[]) {
  const successfulSources = reports.filter((report) =>
    ["success", "empty"].includes(report.state),
  ).length;
  const timedOutSources = reports.filter((report) => report.state === "timeout").length;
  return {
    plannedSources: reports.length,
    successfulSources,
    failedSources: reports.length - successfulSources - timedOutSources,
    timedOutSources,
    statement: disclosureStatement(reports),
  };
}

function liveComparableOffers(offers: Offer[], reports: ConnectorReport[]): Offer[] {
  const findings = reviewOffers(offers, reports);
  const blocked = new Set(
    findings
      .filter((finding) => finding.severity === "blocking" && finding.offerId)
      .map((finding) => finding.offerId),
  );
  return offers.filter((offer) => !blocked.has(offer.id));
}

async function runSearch(
  intent: SearchIntent,
  connectors: FlightConnector[],
  timeoutMs: number,
  executionPolicy: ConnectorExecutionPolicy,
): Promise<Omit<SearchResponse, "audit">> {
  const requestId = crypto.randomUUID();
  const executions = await Promise.all(
    connectors.map((connector) =>
      executeConnector(connector, intent, requestId, timeoutMs, executionPolicy),
    ),
  );
  const reports = executions.map((execution) => execution.report);
  const normalized = applyIntentConstraints(
    deduplicateOffers(executions.flatMap((execution) => execution.result.offers)),
    intent,
  );
  const allowed = liveComparableOffers(normalized, reports);
  const cheapest = rankByLowestComparablePrice(allowed);
  const recommended = rankRecommended(allowed);
  const shortest = rankByShortestDuration(allowed);
  const fewestStops = rankByFewestStops(allowed);
  const bestBaggage = rankByBestBaggage(allowed);
  const mostFlexible = rankByRefundFlexibility(allowed);

  return {
    requestId,
    intent,
    offers: normalized,
    connectorReports: reports,
    lowestComparableOfferId: cheapest[0]?.id ?? null,
    recommendedOfferId: recommended[0]?.id ?? null,
    shortestOfferId: shortest[0]?.id ?? null,
    fewestStopsOfferId: fewestStops[0]?.id ?? null,
    bestBaggageOfferId: bestBaggage[0]?.id ?? null,
    mostFlexibleOfferId: mostFlexible[0]?.id ?? null,
    disclosure: coverage(reports),
  };
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options;
  const now = options.now ?? (() => new Date());
  const connectors = options.connectors ?? createConnectorRegistry(config.connectors);
  const auditStore =
    options.auditStore === undefined && config.databaseUrl
      ? createSearchAuditStore(config.databaseUrl)
      : options.auditStore ?? null;
  const localIntentParser = new LocalChineseIntentParser(now);
  const intentParser =
    options.intentParser === undefined
      ? config.openaiIntentParserEnabled && config.openaiApiKey
        ? new FallbackIntentParser(
            new OpenAIIntentParser(config.openaiApiKey, config.openaiModel, now),
            localIntentParser,
          )
        : localIntentParser
      : options.intentParser;

  const app = Fastify({
    logger: config.nodeEnv === "test" ? false : { level: config.logLevel },
    trustProxy: true,
    bodyLimit: 64 * 1024,
    requestIdHeader: false,
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || config.webOrigins.includes(origin)) return callback(null, true);
      callback(new Error("Origin is not allowed."), false);
    },
    methods: ["GET", "POST"],
  });
  await app.register(rateLimit, {
    max: 30,
    timeWindow: "1 minute",
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "flight-lens-api",
    version: "v1-development",
    database: auditStore ? "configured" : "unconfigured",
    intentParser:
      config.openaiIntentParserEnabled && config.openaiApiKey
        ? "openai_with_local_fallback"
        : "local_deterministic_zh",
    connectors: {
      configured: connectors.length,
      purchaseHandoffConfigured: connectors.filter(
        (connector) => connector.metadata.resultRole === "purchase_handoff",
      ).length,
      verificationConfigured: connectors.filter(
        (connector) => connector.metadata.resultRole === "verification",
      ).length,
      releaseMinimumPurchaseHandoff: 2,
    },
    timestamp: new Date().toISOString(),
  }));

  app.get("/v1/meta/connectors", async () => ({
    connectors: connectors.map((connector) => connector.metadata),
    disclosure:
      connectors.filter((connector) => connector.metadata.resultRole === "purchase_handoff")
        .length >= 2
        ? "Two or more purchase-handoff connectors are configured. Real coverage still depends on each search response."
        : "V1 release requires at least two independently verified real-time sources with a legal consumer purchase handoff.",
  }));

  app.get("/v1/meta/connectors/health", async () => {
    const checks = await Promise.all(
      connectors.map(async (connector) => {
        try {
          const health = await connector.health(
            AbortSignal.timeout(Math.min(config.connectorTimeoutMs, 5_000)),
          );
          return { ...connector.metadata, health };
        } catch (error) {
          return {
            ...connector.metadata,
            health: {
              state: "unavailable" as const,
              checkedAt: now().toISOString(),
              detail: error instanceof Error ? error.message : "Unknown health-check failure",
            },
          };
        }
      }),
    );
    return {
      connectors: checks,
      healthy: checks.filter((connector) => connector.health.state === "healthy").length,
      checkedAt: now().toISOString(),
    };
  });

  app.post("/v1/intents/parse", async (request, reply) => {
    const body = request.body as { text?: unknown };
    if (typeof body?.text !== "string" || body.text.trim().length < 3 || body.text.length > 2_000) {
      return reply.status(400).send({
        error: {
          code: "INVALID_INTENT_TEXT",
          message: "请输入 3–2000 个字符的航班需求。",
        },
      });
    }
    if (!intentParser) {
      return reply.status(503).send({
        error: {
          code: "INTENT_PARSER_UNCONFIGURED",
          message: "对话解析尚未配置；你仍可使用完整条件表单。",
        },
      });
    }
    try {
      return reply.status(200).send(await intentParser.parse(body.text.trim()));
    } catch (error) {
      request.log.error({ error }, "Intent parser failed");
      return reply.status(502).send({
        error: {
          code: "INTENT_PARSE_FAILED",
          message: "暂时无法解析这段需求，请修改表达或使用条件表单。",
        },
      });
    }
  });

  app.post("/v1/searches", {
    config: {
      rateLimit: {
        max: 2,
        timeWindow: "1 minute",
      },
    },
  }, async (request, reply) => {
    const parsed = searchIntentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "INVALID_SEARCH_INTENT",
          message: "搜索条件不完整或不合法。",
          issues: parsed.error.issues,
        },
      });
    }

    const today = now().toISOString().slice(0, 10);
    if (parsed.data.departureDate < today) {
      return reply.status(400).send({
        error: {
          code: "SEARCH_DATE_IN_PAST",
          message: "出发日期不能早于今天。",
        },
      });
    }

    if (connectors.length === 0) {
      return reply.status(503).send({
        error: {
          code: "NO_LIVE_CONNECTORS",
          message: "尚未配置合法实时来源；系统不会用演示价格冒充实时结果。",
        },
      });
    }

    const result = await runSearch(parsed.data, connectors, config.connectorTimeoutMs, {
      ...(config.connectorMaxRetries === undefined
        ? {}
        : { maxRetries: config.connectorMaxRetries }),
      ...(config.connectorCacheTtlMs === undefined
        ? {}
        : { cacheTtlMs: config.connectorCacheTtlMs }),
      ...(config.connectorStaleIfErrorMs === undefined
        ? {}
        : { staleIfErrorMs: config.connectorStaleIfErrorMs }),
    });
    let audit: SearchResponse["audit"] = {
      configured: Boolean(auditStore),
      persisted: false,
    };

    if (auditStore) {
      try {
        await persistAuditWithin(
          auditStore,
          {
            requestId: result.requestId,
            intent: result.intent,
            status: "completed",
            reports: result.connectorReports,
            offers: result.offers,
          },
          config.auditTimeoutMs,
        );
        audit = { configured: true, persisted: true };
      } catch (error) {
        request.log.error({ error, requestId: result.requestId }, "Failed to persist search audit");
        audit = {
          configured: true,
          persisted: false,
          errorCode:
            error instanceof AuditPersistTimeoutError
              ? "AUDIT_PERSIST_TIMEOUT"
              : "AUDIT_PERSIST_FAILED",
        };
      }
    }

    const response = searchResponseSchema.parse({ ...result, audit });
    return reply.status(200).send(response);
  });

  app.addHook("onClose", async () => {
    if (auditStore) await auditStore.close();
  });

  return app;
}
