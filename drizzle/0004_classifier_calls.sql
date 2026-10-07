CREATE TABLE "classifier_calls" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"session_id" text NOT NULL,
	"ip" text NOT NULL,
	"outcome" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "classifier_calls_at_idx" ON "classifier_calls" USING btree ("at");