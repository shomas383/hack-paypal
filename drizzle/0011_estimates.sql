CREATE TABLE "estimates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"input" jsonb NOT NULL,
	"description_key" text NOT NULL,
	"status" text NOT NULL,
	"stage" jsonb,
	"classification" jsonb,
	"result" jsonb,
	"estimator_version" text,
	"rate_version" text,
	"call_id" bigint,
	"cached_from" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "estimates_description_key_created_at_idx" ON "estimates" USING btree ("description_key","created_at");--> statement-breakpoint
CREATE INDEX "estimates_session_id_idx" ON "estimates" USING btree ("session_id");