import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

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
      | "unavailable";
    durationMs: number;
    offerCount: number;
    errorCode?: string | undefined;
    retryable: boolean;
    notes: string[];
    startedAt: string;
    finishedAt: string;
  }>;
  offers: Array<{
    id: string;
    connectorId: string;
    seller: { id: string };
    sourceOfferId: string;
    environment: string;
    comparable: boolean;
    totalPrice: { amountMinor: number; currency: string };
    fetchedAt: string;
    expiresAt?: string | undefined;
    evidenceRef?: string | undefined;
  }>;
};

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
        }
      });
    },
    close: database.close,
  };
}

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
