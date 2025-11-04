CREATE TABLE "container_sales" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"container_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"sale_date" date NOT NULL,
	"container_cost" numeric(15, 2) NOT NULL,
	"commission" numeric(15, 2) NOT NULL,
	"total_amount" numeric(15, 2) NOT NULL,
	"voucher_id" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"ledger_account_id" integer,
	"code" varchar(50) NOT NULL,
	"legal_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"address" text,
	"tax_id" text,
	"payment_terms" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inter_company_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_type" text NOT NULL,
	"from_company_id" integer NOT NULL,
	"to_company_id" integer NOT NULL,
	"transfer_date" date NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"from_ledger_account_id" integer NOT NULL,
	"to_ledger_account_id" integer NOT NULL,
	"from_voucher_id" integer,
	"to_voucher_id" integer,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salary_advance_deductions" (
	"id" serial PRIMARY KEY NOT NULL,
	"salary_advance_id" integer NOT NULL,
	"payroll_month" text NOT NULL,
	"deduction_amount" numeric(15, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salary_advances" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"advance_date" date NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"remaining_balance" numeric(15, 2) NOT NULL,
	"voucher_id" integer,
	"notes" text,
	"fully_paid" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "customers_company_code_unique" ON "customers" USING btree ("company_id","code");