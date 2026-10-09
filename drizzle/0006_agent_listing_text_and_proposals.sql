CREATE TABLE "purchase_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"quote_id" uuid NOT NULL,
	"budget_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"status" text NOT NULL,
	"reasoning" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "test_fixture" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_proposals" ADD CONSTRAINT "purchase_proposals_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;