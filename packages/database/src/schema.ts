import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const connectorState = pgEnum("connector_state", [
  "pending",
  "searching",
  "success",
  "empty",
  "timeout",
  "rate_limited",
  "auth_error",
  "login_required",
  "captcha_required",
  "page_changed",
  "provider_error",
  "invalid_response",
  "unavailable",
  "unsupported_query",
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
    notes: jsonb("notes").$type<string[]>().notNull().default([]),
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

export const observationKind = pgEnum("price_observation_kind", [
  "verified_all_in",
  "listed_only",
  "split_ticket",
]);

export const priceObservations = pgTable(
  "price_observations",
  {
    id: uuid("id").primaryKey(),
    searchId: uuid("search_id")
      .notNull()
      .references(() => searches.id, { onDelete: "cascade" }),
    dedupeKey: text("dedupe_key").notNull(),
    itineraryFingerprint: text("itinerary_fingerprint").notNull(),
    routeKey: text("route_key").notNull(),
    departureDate: text("departure_date").notNull(),
    returnDate: text("return_date"),
    cabin: text("cabin").notNull(),
    flightNumbers: jsonb("flight_numbers").$type<string[]>().notNull().default([]),
    connectorId: text("connector_id").notNull(),
    inventoryFamily: text("inventory_family").notNull(),
    sellerId: text("seller_id").notNull(),
    sellerName: text("seller_name").notNull(),
    kind: observationKind("kind").notNull(),
    baseAmountMinor: integer("base_amount_minor"),
    taxAmountMinor: integer("tax_amount_minor"),
    fuelAmountMinor: integer("fuel_amount_minor"),
    requiredServiceAmountMinor: integer("required_service_amount_minor"),
    totalAmountMinor: integer("total_amount_minor").notNull(),
    currency: text("currency").notNull(),
    totalAmountCnyMinor: integer("total_amount_cny_minor"),
    baggage: jsonb("baggage").notNull().default([]),
    priceVerificationStatus: text("price_verification_status").notNull(),
    handoffPrecision: text("handoff_precision"),
    evidenceRef: text("evidence_ref"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("price_observations_dedupe_idx").on(table.dedupeKey),
    index("price_observations_history_idx").on(
      table.routeKey,
      table.departureDate,
      table.cabin,
      table.observedAt,
    ),
    index("price_observations_itinerary_idx").on(table.itineraryFingerprint, table.observedAt),
  ],
);

export const alertStatus = pgEnum("price_alert_status", ["active", "paused", "deleted"]);

export const priceAlerts = pgTable(
  "price_alerts",
  {
    id: uuid("id").primaryKey(),
    ownerTokenHash: text("owner_token_hash").notNull(),
    intent: jsonb("intent").notNull(),
    targetAmountCnyMinor: integer("target_amount_cny_minor").notNull(),
    checkIntervalMinutes: integer("check_interval_minutes").notNull(),
    ntfyTopic: text("ntfy_topic").notNull(),
    status: alertStatus("status").notNull().default("active"),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }).notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
    lastTriggeredAmountMinor: integer("last_triggered_amount_minor"),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("price_alerts_owner_idx").on(table.ownerTokenHash, table.updatedAt),
    index("price_alerts_due_idx").on(table.status, table.nextCheckAt),
  ],
);

export const alertRuns = pgTable(
  "alert_runs",
  {
    id: uuid("id").primaryKey(),
    alertId: uuid("alert_id")
      .notNull()
      .references(() => priceAlerts.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    state: text("state").notNull(),
    observedAmountCnyMinor: integer("observed_amount_cny_minor"),
    sourceEvidenceUrl: text("source_evidence_url"),
    notificationSent: boolean("notification_sent").notNull().default(false),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("alert_runs_idempotency_idx").on(table.idempotencyKey),
    index("alert_runs_alert_idx").on(table.alertId, table.startedAt),
  ],
);

export const userPreferences = pgTable("user_preferences", {
  ownerTokenHash: text("owner_token_hash").primaryKey(),
  preferences: jsonb("preferences").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
