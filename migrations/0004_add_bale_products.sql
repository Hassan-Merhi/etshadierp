-- Create bale_products table for product master data
CREATE TABLE IF NOT EXISTS "bale_products" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Create unique index for company_id + code
CREATE UNIQUE INDEX IF NOT EXISTS "bale_products_company_code_unique" ON "bale_products" ("company_id","code");

-- Add product_id column to production_bales table
ALTER TABLE "production_bales" ADD COLUMN IF NOT EXISTS "product_id" integer;

-- Make category and grade nullable in production_bales (they can come from product)
ALTER TABLE "production_bales" ALTER COLUMN "category" DROP NOT NULL;
ALTER TABLE "production_bales" ALTER COLUMN "grade" DROP NOT NULL;
