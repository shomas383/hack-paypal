CREATE TABLE "classification_actions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"classification_id" uuid NOT NULL,
	"action" text NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"from_hts10" text,
	"to_hts10" text,
	"reason" text,
	"seller_session" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "seller_statements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"classification_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"answer_id" text NOT NULL,
	"seller_session" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "classifications" ADD COLUMN "base_reasons" jsonb;--> statement-breakpoint
ALTER TABLE "classifications" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "classification_actions" ADD CONSTRAINT "classification_actions_classification_id_classifications_id_fk" FOREIGN KEY ("classification_id") REFERENCES "public"."classifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_statements" ADD CONSTRAINT "seller_statements_classification_id_classifications_id_fk" FOREIGN KEY ("classification_id") REFERENCES "public"."classifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "classification_actions_classification_idx" ON "classification_actions" USING btree ("classification_id");--> statement-breakpoint
CREATE INDEX "seller_statements_classification_idx" ON "seller_statements" USING btree ("classification_id");