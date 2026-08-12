import { and, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import type {
  Offer,
  CreatePriceAlert,
  PriceAlert,
  PriceHistoryQuery,
  PriceObservation,
  SearchIntent,
  UserPreferences,
} from "@flight-lens/contracts";
import { offerFingerprint } from "@flight-lens/domain";

export type SearchAuditPayload = {
  requestId: string;
  intent: unknown;
  status: string;
  reports: Array<{
    connectorId: string;
    connectorName: string;
    state:
      | "pending"
      | "searching"
      | "success"
      | "empty"
      | "timeout"
      | "rate_limited"
      | "auth_error"
      | "login_required"
      | "captcha_required"
      | "page_changed"
      | "provider_error"
      | "invalid_response"
      | "unavailable"
      | "unsupported_query";
    durationMs: number;
    offerCount: number;
    errorCode?: string | undefined;
    retryable: boolean;
    notes: string[];
    startedAt: string;
    finishedAt: string;
  }>;
  offers: Offer[];
};

function componentAmount(offer: Offer, kinds: Offer["priceComponents"][number]["kind"][]): number | null {
  const components = offer.priceComponents.filter((component) => kinds.includes(component.kind));
  return components.length
    ? components.reduce((sum, component) => sum + (component.kind === "discount" ? -component.amountMinor : component.amountMinor), 0)
    : null;
}

function observationKind(offer: Offer): "verified_all_in" | "listed_only" | "split_ticket" {
  if (offer.purchaseMode === "split_ticket") return "split_ticket";
  return offer.comparable ? "verified_all_in" : "listed_only";
}

export function isHistoricalPriceObservation(offer: Offer): boolean {
  return offer.purchaseMode === "split_ticket" ||
    offer.comparable ||
    offer.priceVerificationStatus === "listed_only";
}

function inventoryFamilyFor(connectorId: string): string {
  if (["fliggy-flyai", "fliggy-browser", "fliggy-edge-companion"].includes(connectorId)) return "fliggy";
  if (["ctrip-browser", "ctrip-edge-companion"].includes(connectorId)) return "ctrip";
  if (["qunar-browser", "qunar-edge-companion"].includes(connectorId)) return "qunar";
  if (["tongcheng-browser", "tongcheng-edge-companion"].includes(connectorId)) return "tongcheng";
  if (["serpapi-google-flights"].includes(connectorId)) return "google-flights-metasearch";
  if (["skyscanner-live-prices", "flightapi-skyscanner"].includes(connectorId)) return "skyscanner-metasearch";
  if (connectorId === "duffel-flights") return "duffel-air-content";
  if (connectorId === "amadeus-flight-offers") return "amadeus-gds";
  return connectorId;
}

export function buildPriceObservationRow(intent: SearchIntent, searchId: string, offer: Offer) {
  const itineraryFingerprint = offerFingerprint(offer);
  const routeKey = `${intent.origin.code}-${intent.destination.code}`;
  const observedAt = new Date(offer.fetchedAt);
  const fiveMinuteBucket = Math.floor(observedAt.getTime() / 300_000);
  const kind = observationKind(offer);
  const dedupeKey = [
    itineraryFingerprint,
    offer.seller.id,
    intent.cabin,
    kind,
    fiveMinuteBucket,
  ].join("::");
  return {
    id: crypto.randomUUID(),
    searchId,
    dedupeKey,
    itineraryFingerprint,
    routeKey,
    departureDate: intent.departureDate,
    returnDate: intent.returnDate ?? null,
    cabin: intent.cabin,
    flightNumbers: offer.segments.map((segment) => `${segment.marketingCarrier}${segment.flightNumber}`),
    connectorId: offer.connectorId,
    inventoryFamily: inventoryFamilyFor(offer.connectorId),
    sellerId: offer.seller.id,
    sellerName: offer.seller.name,
    kind,
    baseAmountMinor: componentAmount(offer, ["base"]),
    taxAmountMinor: componentAmount(offer, ["tax"]),
    fuelAmountMinor: componentAmount(offer, ["fuel"]),
    requiredServiceAmountMinor: componentAmount(offer, ["baggage", "payment", "required_service", "discount"]),
    totalAmountMinor: offer.totalPrice.amountMinor,
    currency: offer.totalPrice.currency,
    totalAmountCnyMinor: offer.totalPriceCny?.amountMinor ?? (offer.totalPrice.currency === "CNY" ? offer.totalPrice.amountMinor : null),
    baggage: offer.baggage,
    priceVerificationStatus: offer.priceVerificationStatus ?? "unverified",
    handoffPrecision: offer.seller.handoffPrecision ?? null,
    evidenceRef: offer.evidenceRef ?? null,
    observedAt,
  };
}

export async function hashOwnerToken(ownerToken: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ownerToken));
  return Buffer.from(digest).toString("hex");
}

export function createDatabase(url: string) {
  const client = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

export function createSearchAuditStore(url: string) {
  const database = createDatabase(url);
  return {
    async persist(payload: SearchAuditPayload): Promise<void> {
      await database.db.transaction(async (transaction) => {
        await transaction.insert(schema.searches).values({
          id: payload.requestId,
          intent: payload.intent,
          status: payload.status,
          plannedSourceCount: payload.reports.length,
          successfulSourceCount: payload.reports.filter((report) =>
            ["success", "empty"].includes(report.state),
          ).length,
          completedAt: new Date(),
        });

        if (payload.reports.length > 0) {
          await transaction.insert(schema.connectorRuns).values(
            payload.reports.map((report) => ({
              id: crypto.randomUUID(),
              searchId: payload.requestId,
              connectorId: report.connectorId,
              connectorName: report.connectorName,
              state: report.state,
              durationMs: report.durationMs,
              offerCount: report.offerCount,
              errorCode: report.errorCode,
              retryable: report.retryable,
              notes: report.notes,
              startedAt: new Date(report.startedAt),
              finishedAt: new Date(report.finishedAt),
            })),
          );
        }

        if (payload.offers.length > 0) {
          const offerRows = payload.offers.map((offer) => ({
              databaseId: crypto.randomUUID(),
              offer,
            }));
          await transaction.insert(schema.offers).values(
            offerRows.map(({ databaseId, offer }) => ({
              id: databaseId,
              searchId: payload.requestId,
              connectorId: offer.connectorId,
              normalizedOfferId: offer.id,
              sellerId: offer.seller.id,
              sourceOfferId: offer.sourceOfferId,
              environment: offer.environment,
              comparable: offer.comparable,
              totalAmountMinor: offer.totalPrice.amountMinor,
              currency: offer.totalPrice.currency,
              normalizedOffer: offer,
              fetchedAt: new Date(offer.fetchedAt),
              expiresAt: offer.expiresAt ? new Date(offer.expiresAt) : null,
            })),
          );
          const verificationRows = offerRows
            .filter(({ offer }) => offer.comparable)
            .map(({ databaseId, offer }) => ({
              id: crypto.randomUUID(),
              offerId: databaseId,
              expectedAmountMinor: offer.totalPrice.amountMinor,
              observedAmountMinor: null,
              currency: offer.totalPrice.currency,
              state: "pending_landing_page_verification",
              evidenceRef: offer.evidenceRef,
            }));
          if (verificationRows.length > 0) {
            await transaction.insert(schema.priceVerifications).values(verificationRows);
          }
          const historicalRows = payload.offers
            .filter(isHistoricalPriceObservation)
            .map((offer) => buildPriceObservationRow(payload.intent as SearchIntent, payload.requestId, offer));
          if (historicalRows.length > 0) {
            await transaction
              .insert(schema.priceObservations)
              .values(historicalRows)
              .onConflictDoNothing({ target: schema.priceObservations.dedupeKey });
          }
        }
      });
    },
    close: database.close,
  };
}

function mapObservation(row: typeof schema.priceObservations.$inferSelect): PriceObservation {
  return {
    id: row.id,
    searchId: row.searchId,
    itineraryFingerprint: row.itineraryFingerprint,
    routeKey: row.routeKey,
    departureDate: row.departureDate,
    returnDate: row.returnDate,
    cabin: row.cabin as PriceObservation["cabin"],
    connectorId: row.connectorId,
    inventoryFamily: row.inventoryFamily,
    sellerId: row.sellerId,
    sellerName: row.sellerName,
    observationKind: row.kind,
    baseAmountMinor: row.baseAmountMinor,
    taxAmountMinor: row.taxAmountMinor,
    fuelAmountMinor: row.fuelAmountMinor,
    requiredServiceAmountMinor: row.requiredServiceAmountMinor,
    totalAmountMinor: row.totalAmountMinor,
    currency: row.currency,
    totalAmountCnyMinor: row.totalAmountCnyMinor,
    baggage: row.baggage as PriceObservation["baggage"],
    priceVerificationStatus: row.priceVerificationStatus as PriceObservation["priceVerificationStatus"],
    handoffPrecision: row.handoffPrecision as PriceObservation["handoffPrecision"],
    evidenceRef: row.evidenceRef,
    observedAt: row.observedAt.toISOString(),
  };
}

function mapAlert(row: typeof schema.priceAlerts.$inferSelect): PriceAlert {
  return {
    id: row.id,
    intent: row.intent as SearchIntent,
    targetAmountCnyMinor: row.targetAmountCnyMinor,
    checkIntervalMinutes: row.checkIntervalMinutes,
    ntfyTopic: row.ntfyTopic,
    status: row.status,
    nextCheckAt: row.nextCheckAt.toISOString(),
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    lastTriggeredAt: row.lastTriggeredAt?.toISOString() ?? null,
    lastTriggeredAmountMinor: row.lastTriggeredAmountMinor,
    lastErrorCode: row.lastErrorCode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createV2Store(url: string) {
  const database = createDatabase(url);
  return {
    async history(query: PriceHistoryQuery, now = new Date()): Promise<PriceObservation[]> {
      const since = new Date(now.getTime() - query.days * 86_400_000);
      const filters = [
        eq(schema.priceObservations.routeKey, `${query.origin}-${query.destination}`),
        eq(schema.priceObservations.departureDate, query.departureDate),
        eq(schema.priceObservations.cabin, query.cabin),
        gte(schema.priceObservations.observedAt, since),
        lte(schema.priceObservations.observedAt, now),
      ];
      if (query.returnDate) filters.push(eq(schema.priceObservations.returnDate, query.returnDate));
      if (query.sellerId) filters.push(eq(schema.priceObservations.sellerId, query.sellerId));
      if (query.flight) filters.push(sql`${schema.priceObservations.flightNumbers} ? ${query.flight}`);
      const rows = await database.db.select().from(schema.priceObservations)
        .where(and(...filters)).orderBy(schema.priceObservations.observedAt).limit(2_000);
      return rows.map(mapObservation);
    },
    async createAlert(input: CreatePriceAlert): Promise<PriceAlert> {
      const now = new Date();
      const id = crypto.randomUUID();
      const ownerTokenHash = await hashOwnerToken(input.ownerToken);
      const nextCheckAt = now;
      await database.db.insert(schema.priceAlerts).values({
        id,
        ownerTokenHash,
        intent: input.intent,
        targetAmountCnyMinor: input.targetAmountCnyMinor,
        checkIntervalMinutes: input.checkIntervalMinutes,
        ntfyTopic: input.ntfyTopic,
        status: "active",
        nextCheckAt,
      });
      const { ownerToken: _, ...publicInput } = input;
      void _;
      return { ...publicInput, id, status: "active", nextCheckAt: nextCheckAt.toISOString(), lastCheckedAt: null, lastTriggeredAt: null, lastTriggeredAmountMinor: null, lastErrorCode: null, createdAt: now.toISOString(), updatedAt: now.toISOString() };
    },
    async listAlerts(ownerToken: string): Promise<PriceAlert[]> {
      const ownerTokenHash = await hashOwnerToken(ownerToken);
      const rows = await database.db.select().from(schema.priceAlerts)
        .where(and(eq(schema.priceAlerts.ownerTokenHash, ownerTokenHash), or(
          eq(schema.priceAlerts.status, "active"),
          eq(schema.priceAlerts.status, "paused"),
        )))
        .orderBy(desc(schema.priceAlerts.updatedAt));
      return rows.map(mapAlert);
    },
    async getAlert(alertId: string): Promise<PriceAlert | null> {
      const [row] = await database.db.select().from(schema.priceAlerts)
        .where(eq(schema.priceAlerts.id, alertId)).limit(1);
      return row ? mapAlert(row) : null;
    },
    async getOwnedAlert(alertId: string, ownerToken: string): Promise<PriceAlert | null> {
      const ownerTokenHash = await hashOwnerToken(ownerToken);
      const [row] = await database.db.select().from(schema.priceAlerts)
        .where(and(eq(schema.priceAlerts.id, alertId), eq(schema.priceAlerts.ownerTokenHash, ownerTokenHash)))
        .limit(1);
      return row ? mapAlert(row) : null;
    },
    async setAlertStatus(alertId: string, ownerToken: string, status: "active" | "paused" | "deleted"): Promise<boolean> {
      const ownerTokenHash = await hashOwnerToken(ownerToken);
      const updated = await database.db.update(schema.priceAlerts).set({
        status,
        updatedAt: new Date(),
        ...(status === "active" ? { nextCheckAt: new Date() } : {}),
      }).where(and(eq(schema.priceAlerts.id, alertId), eq(schema.priceAlerts.ownerTokenHash, ownerTokenHash)))
        .returning({ id: schema.priceAlerts.id });
      return updated.length === 1;
    },
    async dueAlerts(limit: number, now = new Date()) {
      return database.db.select().from(schema.priceAlerts)
        .where(and(eq(schema.priceAlerts.status, "active"), lte(schema.priceAlerts.nextCheckAt, now)))
        .orderBy(schema.priceAlerts.nextCheckAt).limit(Math.max(1, Math.min(20, limit)));
    },
    async claimAlertRun(alertId: string, idempotencyKey: string, now = new Date()): Promise<string | null> {
      const id = crypto.randomUUID();
      const inserted = await database.db.insert(schema.alertRuns).values({ id, alertId, idempotencyKey, state: "running", startedAt: now })
        .onConflictDoNothing({ target: schema.alertRuns.idempotencyKey }).returning({ id: schema.alertRuns.id });
      return inserted[0]?.id ?? null;
    },
    async finishAlertRun(input: {
      runId: string;
      alertId: string;
      checkedAt: Date;
      intervalMinutes: number;
      amountCnyMinor: number | null;
      evidenceUrl: string | null;
      notificationSent: boolean;
      errorCode: string | null;
      resetTrigger: boolean;
    }): Promise<void> {
      await database.db.transaction(async (transaction) => {
        await transaction.update(schema.alertRuns).set({
          state: input.errorCode ? "failed" : "completed",
          observedAmountCnyMinor: input.amountCnyMinor,
          sourceEvidenceUrl: input.evidenceUrl,
          notificationSent: input.notificationSent,
          errorCode: input.errorCode,
          finishedAt: input.checkedAt,
        }).where(eq(schema.alertRuns.id, input.runId));
        const nextCheckAt = new Date(input.checkedAt.getTime() + input.intervalMinutes * 60_000);
        await transaction.update(schema.priceAlerts).set({
          lastCheckedAt: input.checkedAt,
          nextCheckAt,
          lastErrorCode: input.errorCode,
          updatedAt: input.checkedAt,
          ...(input.notificationSent ? {
            lastTriggeredAt: input.checkedAt,
            lastTriggeredAmountMinor: input.amountCnyMinor,
          } : input.resetTrigger ? {
            lastTriggeredAmountMinor: null,
          } : {}),
        }).where(eq(schema.priceAlerts.id, input.alertId));
      });
    },
    async savePreferences(input: UserPreferences): Promise<void> {
      const ownerTokenHash = await hashOwnerToken(input.ownerToken);
      const { ownerToken: _, ...preferences } = input;
      void _;
      await database.db.insert(schema.userPreferences).values({ ownerTokenHash, preferences, updatedAt: new Date() })
        .onConflictDoUpdate({ target: schema.userPreferences.ownerTokenHash, set: { preferences, updatedAt: new Date() } });
    },
    async getPreferences(ownerToken: string): Promise<Omit<UserPreferences, "ownerToken"> | null> {
      const ownerTokenHash = await hashOwnerToken(ownerToken);
      const [row] = await database.db.select({ preferences: schema.userPreferences.preferences }).from(schema.userPreferences)
        .where(eq(schema.userPreferences.ownerTokenHash, ownerTokenHash)).limit(1);
      return row?.preferences as Omit<UserPreferences, "ownerToken"> | null;
    },
    async clearPreferences(ownerToken: string): Promise<void> {
      const ownerTokenHash = await hashOwnerToken(ownerToken);
      await database.db.delete(schema.userPreferences)
        .where(eq(schema.userPreferences.ownerTokenHash, ownerTokenHash));
    },
    async clearAlerts(ownerToken: string): Promise<number> {
      const ownerTokenHash = await hashOwnerToken(ownerToken);
      const deleted = await database.db.update(schema.priceAlerts).set({ status: "deleted", updatedAt: new Date() })
        .where(and(eq(schema.priceAlerts.ownerTokenHash, ownerTokenHash), or(
          eq(schema.priceAlerts.status, "active"),
          eq(schema.priceAlerts.status, "paused"),
        )))
        .returning({ id: schema.priceAlerts.id });
      return deleted.length;
    },
    close: database.close,
  };
}

export type V2Store = ReturnType<typeof createV2Store>;

export type PriceVerificationOutcome = "observed" | "sold_out" | "landing_unavailable";

export type PriceVerificationInput = {
  normalizedOfferId: string;
  outcome: PriceVerificationOutcome;
  observedAmountMinor?: number;
  currency: string;
  evidenceRef: string;
};

export type PriceDeviation = {
  deltaMinor: number;
  absoluteBasisPoints: number;
};

export function calculatePriceDeviation(
  expectedAmountMinor: number,
  observedAmountMinor: number,
): PriceDeviation {
  if (!Number.isSafeInteger(expectedAmountMinor) || expectedAmountMinor <= 0) {
    throw new Error("Expected amount must be a positive integer in minor units.");
  }
  if (!Number.isSafeInteger(observedAmountMinor) || observedAmountMinor < 0) {
    throw new Error("Observed amount must be a non-negative integer in minor units.");
  }
  const deltaMinor = observedAmountMinor - expectedAmountMinor;
  return {
    deltaMinor,
    absoluteBasisPoints: Math.round(
      Math.abs(deltaMinor) / expectedAmountMinor * 10_000,
    ),
  };
}

export async function recordPriceVerification(
  url: string,
  input: PriceVerificationInput,
) {
  if (
    !input.normalizedOfferId.trim() ||
    input.normalizedOfferId.length > 500 ||
    /[\r\n]/.test(input.normalizedOfferId)
  ) {
    throw new Error("Normalized offer ID must be a single non-empty line up to 500 characters.");
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) {
    throw new Error("Currency must be an uppercase ISO 4217 code.");
  }
  if (
    !input.evidenceRef.trim() ||
    input.evidenceRef.length > 500 ||
    /[\r\n]/.test(input.evidenceRef)
  ) {
    throw new Error("Evidence reference must be a single non-empty line up to 500 characters.");
  }
  if (
    input.outcome === "observed" &&
    (!Number.isSafeInteger(input.observedAmountMinor) ||
      (input.observedAmountMinor ?? -1) < 0)
  ) {
    throw new Error("Observed outcome requires a non-negative amount in minor units.");
  }
  if (input.outcome !== "observed" && input.observedAmountMinor !== undefined) {
    throw new Error("Only an observed outcome can include an amount.");
  }

  const database = createDatabase(url);
  try {
    const [offer] = await database.db
      .select({
        id: schema.offers.id,
        currency: schema.offers.currency,
      })
      .from(schema.offers)
      .where(eq(schema.offers.normalizedOfferId, input.normalizedOfferId))
      .orderBy(desc(schema.offers.fetchedAt))
      .limit(1);
    if (!offer) throw new Error("No stored offer matches the normalized offer ID.");
    if (offer.currency !== input.currency) {
      throw new Error(
        `Currency mismatch: stored offer is ${offer.currency}, observation is ${input.currency}.`,
      );
    }

    const [verification] = await database.db
      .select()
      .from(schema.priceVerifications)
      .where(eq(schema.priceVerifications.offerId, offer.id))
      .orderBy(desc(schema.priceVerifications.verifiedAt))
      .limit(1);
    if (!verification) throw new Error("The stored offer has no verification record.");

    const deviation =
      input.outcome === "observed"
        ? calculatePriceDeviation(
            verification.expectedAmountMinor,
            input.observedAmountMinor!,
          )
        : null;
    const state =
      input.outcome === "observed"
        ? deviation?.deltaMinor === 0
          ? "verified_match"
          : "verified_price_changed"
        : input.outcome;
    const verifiedAt = new Date();

    await database.db
      .update(schema.priceVerifications)
      .set({
        observedAmountMinor:
          input.outcome === "observed" ? input.observedAmountMinor : null,
        state,
        evidenceRef: input.evidenceRef,
        verifiedAt,
      })
      .where(eq(schema.priceVerifications.id, verification.id));

    return {
      verificationId: verification.id,
      normalizedOfferId: input.normalizedOfferId,
      expectedAmountMinor: verification.expectedAmountMinor,
      observedAmountMinor:
        input.outcome === "observed" ? input.observedAmountMinor! : null,
      currency: input.currency,
      state,
      deviation,
      evidenceRef: input.evidenceRef,
      verifiedAt: verifiedAt.toISOString(),
    };
  } finally {
    await database.close();
  }
}

export { schema };
