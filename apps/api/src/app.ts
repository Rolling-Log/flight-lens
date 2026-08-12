import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import {
  createConnectorRegistry,
  connectorApplicability,
  executeConnector,
  withCompanionConnectors,
  type ConnectorExecutionPolicy,
  type FlightConnector,
} from "@flight-lens/connectors";
import {
  companionSearchRequestSchema,
  createPriceAlertSchema,
  priceHistoryQuerySchema,
  priceHistoryResponseSchema,
  userPreferencesSchema,
  searchIntentSchema,
  searchResponseSchema,
  type ConnectorReport,
  type SearchIntent,
  type SearchResponse,
} from "@flight-lens/contracts";
import { createSearchAuditStore, createV2Store, type V2Store } from "@flight-lens/database";
import {
  analyzePriceTrend,
  applyIntentConstraints,
  applyAdversarialComparability,
  deduplicateOffers,
  disclosureStatement,
  rankByBestBaggage,
  rankByFewestStops,
  rankByLowestComparablePrice,
  rankByLowestSplitPrice,
  rankRecommended,
  rankByRefundFlexibility,
  rankByShortestDuration,
  planBoundedSearch,
} from "@flight-lens/domain";
import Fastify, { type FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import type { ApiConfig } from "./config.js";
import {
  FallbackIntentParser,
  LocalChineseIntentParser,
  OpenAIIntentParser,
  type IntentParser,
} from "./intent-parser.js";
import { createMonitorQueue, type MonitorQueue } from "./monitor-queue.js";
import { NtfyNotifier, type Notifier } from "./ntfy.js";

type SearchAuditStore = {
  persist(payload: Parameters<ReturnType<typeof createSearchAuditStore>["persist"]>[0]): Promise<void>;
  close(): Promise<void>;
};

type BuildAppOptions = {
  config: ApiConfig;
  connectors?: FlightConnector[];
  auditStore?: SearchAuditStore | null;
  v2Store?: V2Store | null;
  monitorQueue?: MonitorQueue | null;
  notifier?: Notifier;
  intentParser?: IntentParser | null;
  now?: () => Date;
};

function ownerTokenFrom(headers: Record<string, unknown>): string | null {
  const value = headers["x-flight-lens-owner"];
  return typeof value === "string" && value.length >= 16 && value.length <= 128 ? value : null;
}

function monitorIdempotencyKey(alertId: string, checkedAt: Date, intervalMinutes: number): string {
  const bucket = Math.floor(checkedAt.getTime() / (intervalMinutes * 60_000));
  return `${alertId}:${bucket}`;
}

function secretMatches(actual: string | undefined, expected: string | undefined): boolean {
  if (!actual || !expected) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

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
  const splitCheapest = rankByLowestSplitPrice(reviewed);
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
    lowestSplitOfferId: splitCheapest[0]?.id ?? null,
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
  const v2Store =
    options.v2Store === undefined && config.databaseUrl
      ? createV2Store(config.databaseUrl)
      : options.v2Store ?? null;
  const notifier = options.notifier ?? new NtfyNotifier(config.ntfyBaseUrl, config.ntfyAccessToken);
  const monitorQueue =
    options.monitorQueue === undefined && config.databaseUrl
      ? createMonitorQueue(config.databaseUrl, config.monitorExecutionTimeoutMs)
      : options.monitorQueue ?? null;
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
    bodyLimit: 512 * 1024,
    requestIdHeader: false,
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || config.webOrigins.includes(origin)) return callback(null, true);
      callback(null, false);
    },
    methods: ["GET", "POST", "PATCH", "DELETE"],
  });
  await app.register(rateLimit, {
    max: config.nodeEnv === "test" ? 1_000 : 30,
    timeWindow: "1 minute",
  });

  const persistSearch = async (result: Omit<SearchResponse, "audit">): Promise<void> => {
    if (!auditStore) return;
    await persistAuditWithin(auditStore, {
      requestId: result.requestId,
      intent: result.intent,
      status: "completed",
      reports: result.connectorReports,
      offers: result.offers,
    }, config.auditTimeoutMs);
  };

  const processAlert = async (alertId: string): Promise<void> => {
    if (!v2Store) throw new Error("V2_STORE_UNCONFIGURED");
    const alert = await v2Store.getAlert(alertId);
    if (!alert || alert.status !== "active") return;
    const checkedAt = now();
    const runId = await v2Store.claimAlertRun(
      alert.id,
      monitorIdempotencyKey(alert.id, checkedAt, alert.checkIntervalMinutes),
      checkedAt,
    );
    if (!runId) return;
    try {
      const searchTimeoutMs = Math.max(1_000, Math.min(
        config.connectorTimeoutMs,
        config.monitorExecutionTimeoutMs - config.auditTimeoutMs - 1_000,
      ));
      const result = await runSearch(alert.intent, connectors, searchTimeoutMs, {
        maxRetries: Math.min(1, config.connectorMaxRetries ?? 1),
        cacheTtlMs: config.connectorCacheTtlMs ?? 60_000,
        staleIfErrorMs: config.connectorStaleIfErrorMs ?? 300_000,
      });
      await persistSearch(result);
      const lowest = result.offers.find((offer) => offer.id === result.lowestComparableOfferId);
      const amount = lowest?.totalPriceCny?.amountMinor ??
        (lowest?.totalPrice.currency === "CNY" ? lowest.totalPrice.amountMinor : null);
      if (amount === null || amount === undefined) {
        await v2Store.finishAlertRun({
          runId,
          alertId: alert.id,
          checkedAt,
          intervalMinutes: alert.checkIntervalMinutes,
          amountCnyMinor: null,
          evidenceUrl: null,
          notificationSent: false,
          errorCode: "NO_VERIFIED_PRICE",
          resetTrigger: false,
        });
        return;
      }
      const shouldNotify = amount <= alert.targetAmountCnyMinor &&
        (alert.lastTriggeredAmountMinor === null || amount < alert.lastTriggeredAmountMinor);
      let notificationSent = false;
      let notificationError: string | null = null;
      if (shouldNotify) {
        try {
          await notifier.send({
            topic: alert.ntfyTopic,
            title: "航探降价提醒",
            message: `${alert.intent.origin.code} → ${alert.intent.destination.code} 的最低可核验全价已到 ¥${Math.round(amount / 100)}。`,
            ...(lowest?.seller.deepLink ? { clickUrl: lowest.seller.deepLink } : {}),
          }, AbortSignal.timeout(Math.max(250, Math.min(
            10_000,
            config.monitorExecutionTimeoutMs - searchTimeoutMs - config.auditTimeoutMs,
          ))));
          notificationSent = true;
        } catch {
          notificationError = "NOTIFICATION_FAILED";
        }
      }
      await v2Store.finishAlertRun({
        runId,
        alertId: alert.id,
        checkedAt,
        intervalMinutes: alert.checkIntervalMinutes,
        amountCnyMinor: amount,
        evidenceUrl: lowest?.seller.deepLink ?? null,
        notificationSent,
        errorCode: notificationError,
        resetTrigger: amount > alert.targetAmountCnyMinor,
      });
    } catch (error) {
      await v2Store.finishAlertRun({
        runId,
        alertId: alert.id,
        checkedAt,
        intervalMinutes: alert.checkIntervalMinutes,
        amountCnyMinor: null,
        evidenceUrl: null,
        notificationSent: false,
        errorCode: error instanceof Error ? error.message.slice(0, 100) : "MONITOR_FAILED",
        resetTrigger: false,
      });
      throw error;
    }
  };

  if (monitorQueue) await monitorQueue.start(processAlert);

  app.get("/health", async () => ({
    status: "ok",
    service: "flight-lens-api",
    version: "v2-development",
    database: auditStore && v2Store ? "configured" : "unconfigured",
    monitoring: {
      storeConfigured: Boolean(v2Store),
      queueConfigured: Boolean(monitorQueue),
      wakeProtected: Boolean(config.monitorWakeSecret),
      batchMaximum: config.monitorBatchMax,
    },
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

  app.get("/v2/prices/history", async (request, reply) => {
    if (!v2Store) return reply.status(503).send({ error: { code: "V2_STORE_UNCONFIGURED", message: "价格历史数据库尚未配置。" } });
    const parsed = priceHistoryQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: { code: "INVALID_HISTORY_QUERY", message: "价格历史查询条件不合法。", issues: parsed.error.issues } });
    const observations = await v2Store.history(parsed.data, now());
    const trends = Object.fromEntries(
      (["verified_all_in", "listed_only", "split_ticket"] as const).map((kind) => [
        kind,
        analyzePriceTrend(
          observations
            .filter((item) => item.observationKind === kind && item.totalAmountCnyMinor !== null)
            .map((item) => ({ amountMinor: item.totalAmountCnyMinor!, observedAt: item.observedAt })),
          parsed.data.days,
        ),
      ]),
    );
    return reply.send(priceHistoryResponseSchema.parse({ query: parsed.data, observations, trends }));
  });

  app.delete("/v2/prices/history", async (request, reply) => {
    if (!v2Store) return reply.status(503).send({ error: { code: "V2_STORE_UNCONFIGURED" } });
    if (!ownerTokenFrom(request.headers)) {
      return reply.status(401).send({ error: { code: "OWNER_TOKEN_REQUIRED" } });
    }
    const parsed = priceHistoryQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: { code: "INVALID_HISTORY_QUERY", message: "价格历史查询条件不合法。", issues: parsed.error.issues } });
    return reply.send({ deleted: await v2Store.clearHistory(parsed.data) });
  });

  app.post("/v2/searches/plan", async (request, reply) => {
    const body = request.body as { intent?: unknown; maximumCombinations?: unknown };
    const parsed = searchIntentSchema.safeParse(body?.intent);
    if (!parsed.success) return reply.status(400).send({ error: { code: "INVALID_SEARCH_INTENT", message: "搜索条件不完整或不合法。" } });
    const maximum = typeof body.maximumCombinations === "number" ? body.maximumCombinations : 9;
    return reply.send(planBoundedSearch(parsed.data, maximum));
  });

  app.get("/v2/alerts", async (request, reply) => {
    if (!v2Store) return reply.status(503).send({ error: { code: "V2_STORE_UNCONFIGURED" } });
    const ownerToken = ownerTokenFrom(request.headers);
    if (!ownerToken) return reply.status(401).send({ error: { code: "OWNER_TOKEN_REQUIRED" } });
    return reply.send({ alerts: await v2Store.listAlerts(ownerToken) });
  });

  app.post("/v2/alerts", async (request, reply) => {
    if (!v2Store) return reply.status(503).send({ error: { code: "V2_STORE_UNCONFIGURED" } });
    const parsed = createPriceAlertSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: "INVALID_ALERT", issues: parsed.error.issues } });
    return reply.status(201).send(await v2Store.createAlert(parsed.data));
  });

  app.patch("/v2/alerts/:id", async (request, reply) => {
    if (!v2Store) return reply.status(503).send({ error: { code: "V2_STORE_UNCONFIGURED" } });
    const ownerToken = ownerTokenFrom(request.headers);
    const status = (request.body as { status?: unknown })?.status;
    const id = (request.params as { id: string }).id;
    if (!ownerToken) return reply.status(401).send({ error: { code: "OWNER_TOKEN_REQUIRED" } });
    if (!['active', 'paused'].includes(String(status))) return reply.status(400).send({ error: { code: "INVALID_ALERT_STATUS" } });
    const changed = await v2Store.setAlertStatus(id, ownerToken, status as "active" | "paused");
    return changed ? reply.status(204).send() : reply.status(404).send({ error: { code: "ALERT_NOT_FOUND" } });
  });

  app.delete("/v2/alerts/:id", async (request, reply) => {
    if (!v2Store) return reply.status(503).send({ error: { code: "V2_STORE_UNCONFIGURED" } });
    const ownerToken = ownerTokenFrom(request.headers);
    const id = (request.params as { id: string }).id;
    if (!ownerToken) return reply.status(401).send({ error: { code: "OWNER_TOKEN_REQUIRED" } });
    const changed = await v2Store.setAlertStatus(id, ownerToken, "deleted");
    return changed ? reply.status(204).send() : reply.status(404).send({ error: { code: "ALERT_NOT_FOUND" } });
  });

  app.delete("/v2/alerts", async (request, reply) => {
    if (!v2Store) return reply.status(503).send({ error: { code: "V2_STORE_UNCONFIGURED" } });
    const ownerToken = ownerTokenFrom(request.headers);
    if (!ownerToken) return reply.status(401).send({ error: { code: "OWNER_TOKEN_REQUIRED" } });
    return reply.send({ deleted: await v2Store.clearAlerts(ownerToken) });
  });

  app.post("/v2/alerts/:id/test", async (request, reply) => {
    if (!v2Store || !monitorQueue) return reply.status(503).send({ error: { code: "MONITOR_UNCONFIGURED" } });
    const ownerToken = ownerTokenFrom(request.headers);
    const id = (request.params as { id: string }).id;
    if (!ownerToken) return reply.status(401).send({ error: { code: "OWNER_TOKEN_REQUIRED" } });
    const alert = await v2Store.getOwnedAlert(id, ownerToken);
    if (!alert || alert.status === "deleted") return reply.status(404).send({ error: { code: "ALERT_NOT_FOUND" } });
    if (alert.status !== "active") return reply.status(409).send({ error: { code: "ALERT_NOT_ACTIVE" } });
    const jobId = await monitorQueue.enqueue(alert.id);
    return jobId
      ? reply.status(202).send({ queued: true, alertId: alert.id })
      : reply.status(202).send({ queued: false, alertId: alert.id, reason: "already_queued" });
  });

  app.get("/v2/preferences", async (request, reply) => {
    if (!v2Store) return reply.status(503).send({ error: { code: "V2_STORE_UNCONFIGURED" } });
    const ownerToken = ownerTokenFrom(request.headers);
    if (!ownerToken) return reply.status(401).send({ error: { code: "OWNER_TOKEN_REQUIRED" } });
    return reply.send({ preferences: await v2Store.getPreferences(ownerToken) });
  });

  app.post("/v2/preferences", async (request, reply) => {
    if (!v2Store) return reply.status(503).send({ error: { code: "V2_STORE_UNCONFIGURED" } });
    const parsed = userPreferencesSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: "INVALID_PREFERENCES", issues: parsed.error.issues } });
    await v2Store.savePreferences(parsed.data);
    return reply.status(204).send();
  });

  app.delete("/v2/preferences", async (request, reply) => {
    if (!v2Store) return reply.status(503).send({ error: { code: "V2_STORE_UNCONFIGURED" } });
    const ownerToken = ownerTokenFrom(request.headers);
    if (!ownerToken) return reply.status(401).send({ error: { code: "OWNER_TOKEN_REQUIRED" } });
    await v2Store.clearPreferences(ownerToken);
    return reply.status(204).send();
  });

  app.post("/internal/monitor/wake", async (request, reply) => {
    if (!secretMatches(request.headers.authorization?.replace(/^Bearer\s+/i, ""), config.monitorWakeSecret)) {
      return reply.status(401).send({ error: { code: "INVALID_WAKE_SECRET" } });
    }
    if (!v2Store || !monitorQueue) return reply.status(503).send({ error: { code: "MONITOR_UNCONFIGURED" } });
    const due = await v2Store.dueAlerts(config.monitorBatchMax, now());
    const enqueued = await Promise.all(due.map((alert) => monitorQueue.enqueue(alert.id)));
    return reply.send({ due: due.length, enqueued: enqueued.filter(Boolean).length, batchMaximum: config.monitorBatchMax });
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
    const companionRequest = companionSearchRequestSchema.safeParse(request.body);
    const parsed = searchIntentSchema.safeParse(
      companionRequest.success ? companionRequest.data.intent : request.body,
    );
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

    const searchConnectors = companionRequest.success
      ? withCompanionConnectors(
          connectors,
          companionRequest.data.companion.results,
          parsed.data,
        )
      : connectors;

    if (searchConnectors.length === 0) {
      return reply.status(503).send({
        error: {
          code: "NO_LIVE_CONNECTORS",
          message: "尚未配置合法实时来源；系统不会用演示价格冒充实时结果。",
        },
      });
    }

    const result = await runSearch(parsed.data, searchConnectors, config.connectorTimeoutMs, {
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
        await persistSearch(result);
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
    if (monitorQueue) await monitorQueue.stop();
    if (v2Store) await v2Store.close();
    if (auditStore) await auditStore.close();
  });

  return app;
}
