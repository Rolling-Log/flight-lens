DROP INDEX "price_observations_history_idx";--> statement-breakpoint
ALTER TABLE "price_observations" ADD COLUMN "adults" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "price_observations_history_idx" ON "price_observations" USING btree ("route_key","departure_date","cabin","adults","observed_at");