ALTER TYPE "public"."connector_state" ADD VALUE 'pending' BEFORE 'success';--> statement-breakpoint
ALTER TYPE "public"."connector_state" ADD VALUE 'searching' BEFORE 'success';--> statement-breakpoint
ALTER TYPE "public"."connector_state" ADD VALUE 'login_required' BEFORE 'provider_error';--> statement-breakpoint
ALTER TYPE "public"."connector_state" ADD VALUE 'captcha_required' BEFORE 'provider_error';--> statement-breakpoint
ALTER TYPE "public"."connector_state" ADD VALUE 'page_changed' BEFORE 'provider_error';