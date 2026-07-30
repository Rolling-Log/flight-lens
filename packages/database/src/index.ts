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
      | "success"
      | "empty"
      | "timeout"
      | "rate_limited"
      | "auth_error"
      | "provider_error"
      | "invalid_response"
      | "unavailable";
    durationMs: number;
    offerCount: number;
    errorCode?: string | undefined;
    retryable: boolean;
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
              startedAt: new Date(report.startedAt),
              finishedAt: new Date(report.finishedAt),
            })),
          );
        }

        if (payload.offers.length > 0) {
          await transaction.insert(schema.offers).values(
            payload.offers.map((offer) => ({
              id: crypto.randomUUID(),
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
        }
      });
    },
    close: database.close,
  };
}

export { schema };
