import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import {
  createConnectorRegistry,
  connectorApplicability,
  executeConnector,
  type ConnectorExecutionPolicy,
  type FlightConnector,
} from "@flight-lens/connectors";
import {
  searchIntentSchema,
  searchResponseSchema,
  type ConnectorReport,
  type SearchIntent,
  type SearchResponse,
} from "@flight-lens/contracts";
import { createSearchAuditStore } from "@flight-lens/database";
import {
  applyIntentConstraints,
  applyAdversarialComparability,
  deduplicateOffers,
  disclosureStatement,
  rankByBestBaggage,
  rankByFewestStops,
  rankByLowestComparablePrice,
  rankRecommended,
  rankByRefundFlexibility,
  rankByShortestDuration,
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
  const applicableReports = reports.filter((report) => report.state !== "unsupported_query");
  const successfulSources = applicableReports.filter((report) =>
    ["success", "empty"].includes(report.state),
  ).length;
  const timedOutSources = applicableReports.filter((report) => report.state === "timeout").length;
  return {
    plannedSources: applicableReports.length,
    successfulSources,
    failedSources: applicableReports.length - successfulSources - timedOutSources,
    timedOutSources,
    statement: disclosureStatement(reports),
  };
}

async function runSearch(
  intent: SearchIntent,
  connectors: FlightConnector[],
  timeoutMs: number,
  executionPolicy: ConnectorExecutionPolicy,
): Promise<Omit<SearchResponse, "audit">> {
  const requestId = crypto.randomUUID();
  const applicability = connectors.map((connector) => ({
    connector,
    result: connectorApplicability(connector, intent),
  }));
  const applicable = applicability.filter((item) => item.result.applicable);
  const executions = await Promise.all(
    applicable.map(({ connector }) =>
      executeConnector(connector, intent, requestId, timeoutMs, executionPolicy),
    ),
  );
  const now = new Date().toISOString();
  const unsupportedReports: ConnectorReport[] = applicability.flatMap(({ connector, result }) =>
    result.applicable ? [] : [{
      connectorId: connector.metadata.id,
      connectorName: connector.metadata.name,
      state: "unsupported_query" as const,
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      offerCount: 0,
      errorCode: result.reason,
      retryable: false,
      notes: [`UNSUPPORTED_QUERY:${result.reason}`],
    }],
  );
  const reports = [...executions.map((execution) => execution.report), ...unsupportedReports];
  const normalized = applyIntentConstraints(
    deduplicateOffers(executions.flatMap((execution) => execution.result.offers)),
    intent,
  );
  const reviewed = applyAdversarialComparability(normalized, reports);
  const cheapest = rankByLowestComparablePrice(reviewed);
  const recommended = rankRecommended(reviewed);
  const shortest = rankByShortestDuration(reviewed);
  const fewestStops = rankByFewestStops(reviewed);
  const bestBaggage = rankByBestBaggage(reviewed);
  const mostFlexible = rankByRefundFlexibility(reviewed);

  return {
    requestId,
    intent,
    offers: reviewed,
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
      callback(null, false);
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
      productionConfigured: connectors.filter(
        (connector) => connector.metadata.environment === "production",
      ).length,
      productionPurchaseHandoffConfigured: connectors.filter(
        (connector) =>
          connector.metadata.environment === "production" &&
          connector.metadata.resultRole === "purchase_handoff",
      ).length,
      productionVerificationConfigured: connectors.filter(
        (connector) =>
          connector.metadata.environment === "production" &&
          connector.metadata.resultRole === "verification",
      ).length,
      productionInventoryFamilies: new Set(
        connectors
          .filter((connector) => connector.metadata.environment === "production")
          .map((connector) => connector.metadata.inventoryFamily)
          .filter(Boolean),
      ).size,
      releaseMinimumProductionSources: 4,
      releaseMinimumPurchaseHandoff: 2,
      releaseMinimumVerification: 2,
    },
    timestamp: new Date().toISOString(),
  }));

  app.get("/v1/meta/connectors", async () => {
    const production = connectors.filter(
      (connector) => connector.metadata.environment === "production",
    );
    const purchaseHandoff = production.filter(
      (connector) => connector.metadata.resultRole === "purchase_handoff",
    );
    const verification = production.filter(
      (connector) => connector.metadata.resultRole === "verification",
    );
    const inventoryFamilies = new Set(
      production
        .map((connector) => connector.metadata.inventoryFamily)
        .filter(Boolean),
    );
    const operationalTargetMet =
      production.length >= 4 &&
      purchaseHandoff.length >= 2 &&
      verification.length >= 2 &&
      inventoryFamilies.size >= 4;
    return {
      connectors: connectors.map((connector) => connector.metadata),
      readiness: {
        operationalTargetMet,
        productionSources: production.length,
        productionPurchaseHandoffSources: purchaseHandoff.length,
        productionVerificationSources: verification.length,
        productionInventoryFamilies: inventoryFamilies.size,
        target: {
          productionSources: 4,
          purchaseHandoffSources: 2,
          verificationSources: 2,
          inventoryFamilies: 4,
        },
      },
      disclosure: operationalTargetMet
        ? "The 2+2 production connector target is configured. Real coverage still depends on each search response."
        : "V1 targets two production purchase-handoff sources plus two production verification sources; sandbox connectors never count toward this target.",
    };
  });

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
        max: config.searchRateLimitMax ?? 2,
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

    const unsupportedV1Fields = [
      ...(parsed.data.flexibleDays === 0 ? [] : ["flexibleDays"]),
    ];
    if (unsupportedV1Fields.length > 0) {
      return reply.status(422).send({
        error: {
          code: "V1_SCOPE_UNSUPPORTED",
          message: "V1 正式搜索当前仅支持固定日期。",
          fields: unsupportedV1Fields,
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
