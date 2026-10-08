CREATE TABLE "classifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"input" jsonb NOT NULL,
	"model" text NOT NULL,
	"result" jsonb,
	"error" text,
	"needs_review" boolean NOT NULL,
	"reasons" jsonb NOT NULL,
	"status" text NOT NULL,
	"hts10" text,
	"listing_id" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	"published_by" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "classifications" ADD CONSTRAINT "classifications_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;