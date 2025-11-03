CREATE TABLE "bank_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" text NOT NULL,
	"bank_name" text NOT NULL,
	"account_number" text NOT NULL,
	"routing_code" text,
	"linked_ledger_id" integer,
	"opening_balance" numeric(15, 2) DEFAULT '0',
	"opening_balance_side" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bank_accounts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "companies_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "container_charges" (
	"id" serial PRIMARY KEY NOT NULL,
	"container_id" integer NOT NULL,
	"charge_type" text NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"ledger_account_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "container_offloads" (
	"id" serial PRIMARY KEY NOT NULL,
	"container_id" integer NOT NULL,
	"location_id" integer NOT NULL,
	"duties" numeric(15, 2) DEFAULT '0' NOT NULL,
	"office_charges" numeric(15, 2) DEFAULT '0' NOT NULL,
	"transfer_charges" numeric(15, 2) DEFAULT '0' NOT NULL,
	"transport_fees" numeric(15, 2) DEFAULT '0' NOT NULL,
	"total_charges" numeric(15, 2) DEFAULT '0' NOT NULL,
	"total_bales" numeric(15, 3) NOT NULL,
	"additional_cost_per_bale" numeric(15, 2) NOT NULL,
	"offloaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "containers" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"container_number" varchar(100) NOT NULL,
	"supplier_id" integer NOT NULL,
	"status" text DEFAULT 'OTW' NOT NULL,
	"import_date" date NOT NULL,
	"items_total" numeric(15, 2) DEFAULT '0',
	"charges_total" numeric(15, 2) DEFAULT '0',
	"grand_total" numeric(15, 2) DEFAULT '0',
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "containers_container_number_unique" UNIQUE("container_number")
);
--> statement-breakpoint
CREATE TABLE "employee_group_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_group_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"code" varchar(50) NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"join_date" date NOT NULL,
	"department" text,
	"employee_type" text DEFAULT 'Employee' NOT NULL,
	"monthly_salary" numeric(15, 2) DEFAULT '0' NOT NULL,
	"opening_balance" numeric(15, 2) DEFAULT '0',
	"current_balance" numeric(15, 2) DEFAULT '0' NOT NULL,
	"total_deposits" numeric(15, 2) DEFAULT '0' NOT NULL,
	"total_withdrawals" numeric(15, 2) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "employees_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "fixed_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"purchase_date" date NOT NULL,
	"purchase_amount" numeric(15, 2) NOT NULL,
	"depreciation_method" text DEFAULT 'None' NOT NULL,
	"useful_life" integer,
	"opening_balance" numeric(15, 2),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fixed_assets_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "import_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"file_hash" text NOT NULL,
	"row_count" integer NOT NULL,
	"container_id" integer,
	"status" text NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "import_logs_file_hash_unique" UNIQUE("file_hash")
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"location_id" integer NOT NULL,
	"stock_item_id" integer NOT NULL,
	"quantity" numeric(15, 3) DEFAULT '0' NOT NULL,
	"average_rate" numeric(15, 2) DEFAULT '0' NOT NULL,
	"total_value" numeric(15, 2) DEFAULT '0' NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" text NOT NULL,
	"account_type" text NOT NULL,
	"sub_type" text,
	"parent_id" integer,
	"opening_balance" numeric(15, 2) DEFAULT '0',
	"opening_balance_side" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" text NOT NULL,
	"city" text,
	"state" text,
	"country" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "locations_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "po_line_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"po_id" integer NOT NULL,
	"stock_item_id" integer NOT NULL,
	"item_name" text NOT NULL,
	"quantity" numeric(15, 3) NOT NULL,
	"rate" numeric(15, 2) NOT NULL,
	"line_total" numeric(15, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"po_number" varchar(100) NOT NULL,
	"container_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"voucher_id" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"items_total" numeric(15, 2) DEFAULT '0',
	"status" text DEFAULT 'Open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"voucher_id" integer NOT NULL,
	"stock_item_id" integer NOT NULL,
	"quantity" numeric(15, 3) NOT NULL,
	"selling_price" numeric(15, 2) NOT NULL,
	"cost_price" numeric(15, 2) NOT NULL,
	"total_sales" numeric(15, 2) NOT NULL,
	"total_cost" numeric(15, 2) NOT NULL,
	"profit" numeric(15, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_adjustment_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"adjustment_id" integer NOT NULL,
	"stock_item_id" integer NOT NULL,
	"quantity" numeric(15, 3) NOT NULL,
	"rate" numeric(15, 2) NOT NULL,
	"total_amount" numeric(15, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_adjustment_vouchers" (
	"id" serial PRIMARY KEY NOT NULL,
	"voucher_id" integer NOT NULL,
	"location_id" integer NOT NULL,
	"adjustment_type" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" text NOT NULL,
	"parent_id" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_item_code_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"stock_item_id" integer NOT NULL,
	"alias_code" varchar(50) NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" text NOT NULL,
	"stock_group_id" integer,
	"uom" text NOT NULL,
	"opening_qty" numeric(15, 3) DEFAULT '0',
	"opening_rate" numeric(15, 2) DEFAULT '0',
	"opening_value" numeric(15, 2) DEFAULT '0',
	"reorder_level" numeric(15, 3) DEFAULT '0',
	"selling_price" numeric(15, 2) DEFAULT '0',
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_transfer_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_id" integer NOT NULL,
	"stock_item_id" integer NOT NULL,
	"quantity" numeric(15, 3) NOT NULL,
	"rate" numeric(15, 2) NOT NULL,
	"total_amount" numeric(15, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_transfer_vouchers" (
	"id" serial PRIMARY KEY NOT NULL,
	"voucher_id" integer NOT NULL,
	"source_location_id" integer NOT NULL,
	"destination_location_id" integer NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"legal_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"address" text,
	"tax_id" text,
	"payment_terms" text,
	"opening_balance" numeric(15, 2) DEFAULT '0',
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "user_company_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"company_id" integer NOT NULL,
	"role" text NOT NULL,
	"assigned_location_id" integer,
	"cash_account_id" integer,
	"pos_station" integer,
	"can_sell_negative_stock" boolean DEFAULT false NOT NULL,
	"can_edit_daybook" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "voucher_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"voucher_id" integer NOT NULL,
	"ledger_account_id" integer,
	"bank_account_id" integer,
	"fixed_asset_id" integer,
	"supplier_id" integer,
	"debit_amount" numeric(15, 2) DEFAULT '0',
	"credit_amount" numeric(15, 2) DEFAULT '0',
	"narration" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vouchers" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"location_id" integer,
	"voucher_number" varchar(100) NOT NULL,
	"voucher_type" text NOT NULL,
	"voucher_date" date NOT NULL,
	"description" text,
	"total_amount" numeric(15, 2) NOT NULL,
	"optional" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vouchers_voucher_number_unique" UNIQUE("voucher_number")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "stock_groups_company_code_unique" ON "stock_groups" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_item_code_aliases_company_alias_unique" ON "stock_item_code_aliases" USING btree ("company_id","alias_code");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_items_company_code_unique" ON "stock_items" USING btree ("company_id","code");