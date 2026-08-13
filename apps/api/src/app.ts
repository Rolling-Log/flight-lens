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
  accountPreferencesSchema,
  accountPriceAlertInputSchema,
  anonymousMigrationInputSchema,
  notificationSettingsSchema,
  priceHistoryQuerySchema,
  priceHistoryResponseSchema,
  searchIntentSchema,
  searchResponseSchema,
  savedItineraryInputSchema,
  type ConnectorReport,
  type SearchIntent,
  type SearchResponse,
} from "@flight-lens/contracts";
import {
  createAccountStore,
  createSearchAuditStore,
  createV2Store,
  type AccountStore,
  type V2Store,
} from "@flight-lens/database";
import {
  analyzePriceTrend,
  assessPriceJudgment,
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
import type { IncomingHttpHeaders } from "node:http";
import { createAuthService, type AuthService } from "./auth.js";
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
  authService?: AuthService | null;
  accountStore?: AccountStore | null;
};

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

export function safeRequestPath(rawUrl: string): string {
  const queryIndex = rawUrl.indexOf("?");
  return queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);
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
  const marketPriceInsights = executions.flatMap(
    (execution) => execution.result.marketPriceInsights ?? [],
  );
  const primaryInsight = marketPriceInsights.find((insight) =>
    insight.currency === "CNY" &&
    insight.originCode === intent.origin.code &&
    insight.destinationCode === intent.destination.code &&
    insight.departureDate === intent.departureDate &&
    insight.returnDate === (intent.returnDate ?? null) &&
    insight.tripType === intent.tripType &&
    insight.cabin === intent.cabin &&
    insight.adults === intent.adults,
  );
  const lowestCurrent = cheapest[0];
  const currentAmountMinor = primaryInsight?.lowestPriceMinor ??
    lowestCurrent?.totalPriceCny?.amountMinor ??
    (lowestCurrent?.totalPrice.currency === "CNY" ? lowestCurrent.totalPrice.amountMinor : null) ??
    null;
  const currentPriceBasis = primaryInsight?.lowestPriceMinor !== null && primaryInsight?.lowestPriceMinor !== undefined
    ? "listed_only" as const
    : lowestCurrent
      ? lowestCurrent.purchaseMode === "split_ticket"
        ? "split_ticket" as const
        : lowestCurrent.priceVerificationStatus === "listed_only"
          ? "listed_only" as const
          : "verified_all_in" as const
      : null;
  const priceJudgment = assessPriceJudgment({
    currentAmountMinor,
    currentPriceBasis,
    currency: currentAmountMinor === null ? null : "CNY",
    intent,
    ...(primaryInsight ? { marketInsight: primaryInsight } : {}),
  });

  return {
    requestId,
    intent,
    offers: reviewed,
    connectorReports: reports,
    marketPriceInsights,
    priceJudgment,
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
  const authService = options.authService === undefined
    ? createAuthService(config)
    : options.authService;
  const accountStore = options.accountStore === undefined && config.databaseUrl
    ? createAccountStore(config.databaseUrl)
    : options.accountStore ?? null;
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
    logger: config.nodeEnv === "test" ? false : {
      level: config.logLevel,
      serializers: {
        req(request) {
          return { method: request.method, url: safeRequestPath(request.url) };
        },
      },
    },
    // Render contributes the single trusted hop. Taking only the right-most
    // forwarded address prevents client-supplied entries from becoming identity.
    trustProxy: 1,
    bodyLimit: 512 * 1024,
    requestIdHeader: false,
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || config.webOrigins.includes(origin)) return callback(null, true);
      callback(null, false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type"],
    credentials: true,
    maxAge: 86_400,
  });
  await app.register(rateLimit, {
    max: config.nodeEnv === "test" ? 1_000 : 30,
    timeWindow: "1 minute",
  });

  if (authService) {
    app.route({
      method: ["GET", "POST"],
      url: "/api/auth/*",
      config: { rateLimit: { max: config.nodeEnv === "test" ? 1_000 : 10, timeWindow: "1 minute" } },
      async handler(request, reply) {
        const url = new URL(request.url, config.authBaseUrl ?? "http://localhost:4000");
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers)) {
          if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
          else if (value !== undefined) headers.set(key, String(value));
        }
        headers.set("x-flight-lens-client-ip", request.ip);
        const response = await authService.handler(new Request(url, {
          method: request.method,
          headers,
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        }));
        reply.status(response.status);
        response.headers.forEach((value, key) => {
          if (key.toLowerCase() !== "set-cookie") reply.header(key, value);
        });
        const cookies = response.headers.getSetCookie();
        if (cookies.length) reply.header("set-cookie", cookies);
        return reply.send(response.body ? await response.text() : null);
      },
    });
  }

  async function requireUser(request: { headers: IncomingHttpHeaders; method: string }, reply: { status(code: number): { send(payload: unknown): unknown } }) {
    if (!authService || !accountStore) {
      reply.status(503).send({ error: { code: "ACCOUNT_SERVICE_UNCONFIGURED" } });
      return null;
    }
    const session = await authService.getSession(request.headers);
    if (!session) {
      reply.status(401).send({ error: { code: "AUTHENTICATION_REQUIRED" } });
      return null;
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.headers.origin;
      if (typeof origin !== "string" || !config.webOrigins.includes(origin)) {
        reply.status(403).send({ error: { code: "UNTRUSTED_ORIGIN" } });
        return null;
      }
    }
    return session;
  }

  async function auditAccountEvent(
    request: { log: { warn(context: object, message: string): void } },
    userId: string,
    eventType: string,
    context: Record<string, string | number | boolean | null> = {},
  ) {
    if (!accountStore) return;
    try {
      await accountStore.audit(userId, eventType, context);
    } catch (auditError) {
      request.log.warn({ auditError, eventType }, "Failed to persist account security audit");
    }
  }

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
    revision: config.deploymentRevision ?? "local",
    database: auditStore && v2Store ? "configured" : "unconfigured",
    accounts: {
      authConfigured: Boolean(authService),
      personalStoreConfigured: Boolean(accountStore),
      emailDeliveryConfigured: Boolean(config.authEmailFrom && config.resendApiKey),
    },
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
    void request;
    return reply.status(405).send({
      error: { code: "PUBLIC_HISTORY_IMMUTABLE", message: "公共、去身份化价格观测不属于任何个人账号。" },
    });
  });

  app.post("/v2/searches/plan", async (request, reply) => {
    const body = request.body as { intent?: unknown; maximumCombinations?: unknown };
    const parsed = searchIntentSchema.safeParse(body?.intent);
    if (!parsed.success) return reply.status(400).send({ error: { code: "INVALID_SEARCH_INTENT", message: "搜索条件不完整或不合法。" } });
    const maximum = typeof body.maximumCombinations === "number" ? body.maximumCombinations : 9;
    return reply.send(planBoundedSearch(parsed.data, maximum));
  });

  app.get("/v2/alerts", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session || !accountStore) return;
    return reply.send({
      alerts: await accountStore.listAlerts(session.user.id),
      delivery: {
        serverSchedulingConfigured: Boolean(monitorQueue),
        channel: "ntfy",
      },
    });
  });

  app.post("/v2/alerts", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session || !accountStore) return;
    if (!monitorQueue) return reply.status(503).send({ error: { code: "MONITOR_UNCONFIGURED" } });
    const parsed = accountPriceAlertInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: "INVALID_ALERT", issues: parsed.error.issues } });
    return reply.status(201).send(await accountStore.createAlert(session.user.id, parsed.data));
  });

  app.patch("/v2/alerts/:id", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session || !accountStore) return;
    const status = (request.body as { status?: unknown })?.status;
    const id = (request.params as { id: string }).id;
    if (!['active', 'paused'].includes(String(status))) return reply.status(400).send({ error: { code: "INVALID_ALERT_STATUS" } });
    const changed = await accountStore.setAlertStatus(session.user.id, id, status as "active" | "paused");
    return changed ? reply.status(204).send() : reply.status(404).send({ error: { code: "ALERT_NOT_FOUND" } });
  });

  app.delete("/v2/alerts/:id", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session || !accountStore) return;
    const id = (request.params as { id: string }).id;
    const changed = await accountStore.setAlertStatus(session.user.id, id, "deleted");
    return changed ? reply.status(204).send() : reply.status(404).send({ error: { code: "ALERT_NOT_FOUND" } });
  });

  app.delete("/v2/alerts", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session || !accountStore) return;
    return reply.send({ deleted: await accountStore.clearAlerts(session.user.id) });
  });

  app.post("/v2/alerts/:id/test", async (request, reply) => {
    if (!monitorQueue) return reply.status(503).send({ error: { code: "MONITOR_UNCONFIGURED" } });
    const session = await requireUser(request, reply);
    if (!session || !accountStore) return;
    const id = (request.params as { id: string }).id;
    const alert = await accountStore.getAlert(session.user.id, id);
    if (!alert || alert.status === "deleted") return reply.status(404).send({ error: { code: "ALERT_NOT_FOUND" } });
    if (alert.status !== "active") return reply.status(409).send({ error: { code: "ALERT_NOT_ACTIVE" } });
    const jobId = await monitorQueue.enqueue(alert.id);
    return jobId
      ? reply.status(202).send({ queued: true, alertId: alert.id })
      : reply.status(202).send({ queued: false, alertId: alert.id, reason: "already_queued" });
  });

  app.get("/v2/preferences", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session || !accountStore) return;
    return reply.send({ preferences: await accountStore.getPreferences(session.user.id) });
  });

  app.post("/v2/preferences", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session || !accountStore) return;
    const parsed = accountPreferencesSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: "INVALID_PREFERENCES", issues: parsed.error.issues } });
    await accountStore.savePreferences(session.user.id, parsed.data);
    return reply.status(204).send();
  });

  app.delete("/v2/preferences", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session || !accountStore) return;
    await accountStore.clearPreferences(session.user.id);
    return reply.status(204).send();
  });

  app.get("/v3/me/searches", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session || !accountStore) return;
    return reply.send({ searches: await accountStore.listSearches(session.user.id) });
  });

  app.delete("/v3/me/searches", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session || !accountStore) return;
    return reply.send({ deleted: await accountStore.clearSearches(session.user.id) });
  });

  app.get("/v3/me/itineraries", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session || !accountStore) return;
    return reply.send({ itineraries: await accountStore.listItineraries(session.user.id) });
  });

  app.post("/v3/me/itineraries", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session || !accountStore) return;
    const parsed = savedItineraryInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: "INVALID_ITINERARY", issues: parsed.error.issues } });
    return reply.status(201).send(await accountStore.saveItinerary(session.user.id, parsed.data));
  });

  app.delete("/v3/me/itineraries/:id", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session || !accountStore) return;
    const id = (request.params as { id: string }).id;
    const deleted = await accountStore.deleteItinerary(session.user.id, id);
    return deleted ? reply.status(204).send() : reply.status(404).send({ error: { code: "ITINERARY_NOT_FOUND" } });
  });

  app.get("/v3/me/notifications", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session || !accountStore) return;
    return reply.send({ notifications: await accountStore.getNotifications(session.user.id) });
  });

  app.put("/v3/me/notifications", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session || !accountStore) return;
    const parsed = notificationSettingsSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: "INVALID_NOTIFICATION_SETTINGS", issues: parsed.error.issues } });
    await accountStore.saveNotifications(session.user.id, parsed.data);
    await auditAccountEvent(request, session.user.id, "notification_settings_updated", {
      emailEnabled: parsed.data.emailEnabled,
      pushEnabled: parsed.data.pushEnabled,
    });
    return reply.status(204).send();
  });

  app.post("/v3/me/anonymous-migration", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session || !accountStore) return;
    const parsed = anonymousMigrationInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: "INVALID_MIGRATION", issues: parsed.error.issues } });
    try {
      const migration = await accountStore.migrateAnonymous(session.user.id, parsed.data);
      await auditAccountEvent(request, session.user.id, "anonymous_data_decision", {
        decision: parsed.data.decision,
        status: migration.status,
      });
      return reply.send({ migration });
    } catch (error) {
      if (error instanceof Error && error.message === "ANONYMOUS_TOKEN_ALREADY_CLAIMED") {
        return reply.status(409).send({ error: { code: error.message } });
      }
      throw error;
    }
  });

  app.get("/v3/me/export", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session || !accountStore) return;
    await auditAccountEvent(request, session.user.id, "account_data_exported");
    reply.header("content-disposition", "attachment; filename=flight-lens-export.json");
    return reply.send(await accountStore.exportData(session.user.id));
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
    if (
      result.priceJudgment.status === "unavailable" &&
      result.priceJudgment.currentAmountMinor !== null &&
      result.priceJudgment.currentPriceBasis !== null &&
      v2Store
    ) {
      try {
        const observations = await v2Store.history({
          origin: parsed.data.origin.code,
          destination: parsed.data.destination.code,
          departureDate: parsed.data.departureDate,
          ...(parsed.data.returnDate ? { returnDate: parsed.data.returnDate } : {}),
          cabin: parsed.data.cabin,
          adults: parsed.data.adults,
          days: 365,
        }, now());
        const observationKind = result.priceJudgment.currentPriceBasis;
        result.priceJudgment = assessPriceJudgment({
          currentAmountMinor: result.priceJudgment.currentAmountMinor,
          currentPriceBasis: result.priceJudgment.currentPriceBasis,
          currency: result.priceJudgment.currency,
          intent: parsed.data,
          siteSamples: observations
            .filter((item) => item.observationKind === observationKind && item.totalAmountCnyMinor !== null)
            .map((item) => ({ amountMinor: item.totalAmountCnyMinor!, observedAt: item.observedAt })),
        });
      } catch (historyError) {
        request.log.warn({ historyError }, "Failed to load supplemental site price history");
      }
    }
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

    if (accountStore && authService) {
      try {
        const session = await authService.getSession(request.headers);
        if (session) await accountStore.recordSearch(session.user.id, result.requestId, parsed.data);
      } catch (historyError) {
        request.log.warn({ historyError, requestId: result.requestId }, "Failed to persist personal search history");
      }
    }

    const response = searchResponseSchema.parse({ ...result, audit });
    return reply.status(200).send(response);
  });

  app.addHook("onClose", async () => {
    if (monitorQueue) await monitorQueue.stop();
    if (v2Store) await v2Store.close();
    if (auditStore) await auditStore.close();
    if (authService) await authService.close();
    if (accountStore) await accountStore.close();
  });

  return app;
}
