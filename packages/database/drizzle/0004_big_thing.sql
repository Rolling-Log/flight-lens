CREATE TYPE "public"."price_alert_status" AS ENUM('active', 'paused', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."price_observation_kind" AS ENUM('verified_all_in', 'listed_only', 'split_ticket');--> statement-breakpoint
CREATE TABLE "alert_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"alert_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"state" text NOT NULL,
	"observed_amount_cny_minor" integer,
	"source_evidence_url" text,
	"notification_sent" boolean DEFAULT false NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "price_alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_token_hash" text NOT NULL,
	"intent" jsonb NOT NULL,
	"target_amount_cny_minor" integer NOT NULL,
	"check_interval_minutes" integer NOT NULL,
	"ntfy_topic" text NOT NULL,
	"status" "price_alert_status" DEFAULT 'active' NOT NULL,
	"next_check_at" timestamp with time zone NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_triggered_at" timestamp with time zone,
	"last_triggered_amount_minor" integer,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_observations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"search_id" uuid NOT NULL,
	"dedupe_key" text NOT NULL,
	"itinerary_fingerprint" text NOT NULL,
	"route_key" text NOT NULL,
	"departure_date" text NOT NULL,
	"return_date" text,
	"cabin" text NOT NULL,
	"flight_numbers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"connector_id" text NOT NULL,
	"inventory_family" text NOT NULL,
	"seller_id" text NOT NULL,
	"seller_name" text NOT NULL,
	"kind" "price_observation_kind" NOT NULL,
	"base_amount_minor" integer,
	"tax_amount_minor" integer,
	"fuel_amount_minor" integer,
	"required_service_amount_minor" integer,
	"total_amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"total_amount_cny_minor" integer,
	"baggage" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"price_verification_status" text NOT NULL,
	"handoff_precision" text,
	"evidence_ref" text,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"owner_token_hash" text PRIMARY KEY NOT NULL,
	"preferences" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_runs" ADD CONSTRAINT "alert_runs_alert_id_price_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."price_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_search_id_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_runs_idempotency_idx" ON "alert_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "alert_runs_alert_idx" ON "alert_runs" USING btree ("alert_id","started_at");--> statement-breakpoint
CREATE INDEX "price_alerts_owner_idx" ON "price_alerts" USING btree ("owner_token_hash","updated_at");--> statement-breakpoint
CREATE INDEX "price_alerts_due_idx" ON "price_alerts" USING btree ("status","next_check_at");--> statement-breakpoint
CREATE UNIQUE INDEX "price_observations_dedupe_idx" ON "price_observations" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "price_observations_history_idx" ON "price_observations" USING btree ("route_key","departure_date","cabin","observed_at");--> statement-breakpoint
CREATE INDEX "price_observations_itinerary_idx" ON "price_observations" USING btree ("itinerary_fingerprint","observed_at");
