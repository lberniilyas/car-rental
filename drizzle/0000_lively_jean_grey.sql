CREATE TABLE "agent_requests" (
	"request_id" text PRIMARY KEY NOT NULL,
	"raw_input" text NOT NULL,
	"intent" text NOT NULL,
	"booking_status" text NOT NULL,
	"needs_human_review" boolean DEFAULT false NOT NULL,
	"graph_trace" jsonb NOT NULL,
	"final_state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_logs" (
	"booking_id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" integer NOT NULL,
	"insurance_option" text NOT NULL,
	"deposit_amount" numeric(10, 2) NOT NULL,
	"discount_code" text DEFAULT '' NOT NULL,
	"seasonal_multiplier" real NOT NULL,
	"booking_status" text DEFAULT 'CONFIRMED' NOT NULL,
	"needs_human_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_profiles" (
	"customer_id" text PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"birth_date" date NOT NULL,
	"license_number" text NOT NULL,
	"license_issue_date" date NOT NULL,
	"license_exp_date" date NOT NULL,
	"risk_category" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_catalog" (
	"vehicle_id" text PRIMARY KEY NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"year" integer NOT NULL,
	"category" text NOT NULL,
	"transmission" text NOT NULL,
	"fuel_type" text NOT NULL,
	"base_daily_rate" numeric(10, 2) NOT NULL,
	"vehicles_available" integer NOT NULL,
	"location" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rental_policies_vectors" (
	"id" serial PRIMARY KEY NOT NULL,
	"chunk_key" text NOT NULL,
	"source_section" text,
	"content" text NOT NULL,
	"embedding" vector(384) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rental_policies_vectors_chunk_key_unique" UNIQUE("chunk_key")
);
--> statement-breakpoint
CREATE TABLE "seasonal_pricing_matrix" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" integer NOT NULL,
	"category" text NOT NULL,
	"multiplier" real NOT NULL
);
--> statement-breakpoint
CREATE INDEX "booking_vehicle_dates_idx" ON "booking_logs" USING btree ("vehicle_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "fleet_category_idx" ON "fleet_catalog" USING btree ("category");--> statement-breakpoint
CREATE INDEX "policies_embedding_idx" ON "rental_policies_vectors" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "seasonal_month_category_idx" ON "seasonal_pricing_matrix" USING btree ("month","category");