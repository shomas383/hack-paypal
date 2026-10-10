ALTER TABLE "classifications" ADD COLUMN "kind" text DEFAULT 'b1' NOT NULL;--> statement-breakpoint
ALTER TABLE "classifications" ADD COLUMN "stage" jsonb;--> statement-breakpoint
ALTER TABLE "classifications" ADD COLUMN "grounded" jsonb;--> statement-breakpoint
ALTER TABLE "classifications" ADD COLUMN "call_id" bigint;