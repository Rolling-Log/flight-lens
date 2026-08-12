CREATE TYPE "public"."connector_state" AS ENUM('success', 'empty', 'timeout', 'rate_limited', 'auth_error', 'provider_error', 'invalid_response', 'unavailable');--> statement-breakpoint
CREATE TABLE "connector_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"search_id" uuid NOT NULL,
	"connector_id" text NOT NULL,
	"connector_name" text NOT NULL,
	"state" "connector_state" NOT NULL,
	"duration_ms" integer NOT NULL,
	"offer_count" integer NOT NULL,
	"error_code" text,
	"retryable" boolean NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"search_id" uuid NOT NULL,
	"connector_id" text NOT NULL,
	"normalized_offer_id" text NOT NULL,
	"seller_id" text NOT NULL,
	"source_offer_id" text NOT NULL,
	"environment" text NOT NULL,
	"comparable" boolean NOT NULL,
	"total_amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"normalized_offer" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "price_verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"offer_id" uuid NOT NULL,
	"expected_amount_minor" integer NOT NULL,
	"observed_amount_minor" integer,
	"currency" text NOT NULL,
	"state" text NOT NULL,
	"evidence_ref" text,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "searches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"intent" jsonb NOT NULL,
	"status" text NOT NULL,
	"planned_source_count" integer NOT NULL,
	"successful_source_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "connector_runs" ADD CONSTRAINT "connector_runs_search_id_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_search_id_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_verifications" ADD CONSTRAINT "price_verifications_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connector_runs_search_idx" ON "connector_runs" USING btree ("search_id");--> statement-breakpoint
CREATE INDEX "connector_runs_connector_time_idx" ON "connector_runs" USING btree ("connector_id","started_at");--> statement-breakpoint
CREATE INDEX "offers_search_idx" ON "offers" USING btree ("search_id");--> statement-breakpoint
CREATE INDEX "offers_connector_source_idx" ON "offers" USING btree ("connector_id","source_offer_id");--> statement-breakpoint
CREATE INDEX "offers_normalized_id_idx" ON "offers" USING btree ("normalized_offer_id");--> statement-breakpoint
CREATE INDEX "price_verifications_offer_idx" ON "price_verifications" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "searches_created_at_idx" ON "searches" USING btree ("created_at");