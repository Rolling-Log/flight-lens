import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const connectorState = pgEnum("connector_state", [
  "success",
  "empty",
  "timeout",
  "rate_limited",
  "auth_error",
  "provider_error",
  "invalid_response",
  "unavailable",
]);

export const searches = pgTable(
  "searches",
  {
    id: uuid("id").primaryKey(),
    intent: jsonb("intent").notNull(),
    status: text("status").notNull(),
    plannedSourceCount: integer("planned_source_count").notNull(),
    successfulSourceCount: integer("successful_source_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("searches_created_at_idx").on(table.createdAt)],
);

export const connectorRuns = pgTable(
  "connector_runs",
  {
    id: uuid("id").primaryKey(),
    searchId: uuid("search_id")
      .notNull()
      .references(() => searches.id, { onDelete: "cascade" }),
    connectorId: text("connector_id").notNull(),
    connectorName: text("connector_name").notNull(),
    state: connectorState("state").notNull(),
    durationMs: integer("duration_ms").notNull(),
    offerCount: integer("offer_count").notNull(),
    errorCode: text("error_code"),
    retryable: boolean("retryable").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("connector_runs_search_idx").on(table.searchId),
    index("connector_runs_connector_time_idx").on(table.connectorId, table.startedAt),
  ],
);

export const offers = pgTable(
  "offers",
  {
    id: uuid("id").primaryKey(),
    searchId: uuid("search_id")
      .notNull()
      .references(() => searches.id, { onDelete: "cascade" }),
    connectorId: text("connector_id").notNull(),
    normalizedOfferId: text("normalized_offer_id").notNull(),
    sellerId: text("seller_id").notNull(),
    sourceOfferId: text("source_offer_id").notNull(),
    environment: text("environment").notNull(),
    comparable: boolean("comparable").notNull(),
    totalAmountMinor: integer("total_amount_minor").notNull(),
    currency: text("currency").notNull(),
    normalizedOffer: jsonb("normalized_offer").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    index("offers_search_idx").on(table.searchId),
    index("offers_connector_source_idx").on(table.connectorId, table.sourceOfferId),
    index("offers_normalized_id_idx").on(table.normalizedOfferId),
  ],
);

export const priceVerifications = pgTable(
  "price_verifications",
  {
    id: uuid("id").primaryKey(),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => offers.id, { onDelete: "cascade" }),
    expectedAmountMinor: integer("expected_amount_minor").notNull(),
    observedAmountMinor: integer("observed_amount_minor"),
    currency: text("currency").notNull(),
    state: text("state").notNull(),
    evidenceRef: text("evidence_ref"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("price_verifications_offer_idx").on(table.offerId)],
);
