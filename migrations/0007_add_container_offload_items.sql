CREATE TABLE "container_offload_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"offload_id" integer NOT NULL,
	"stock_item_id" integer NOT NULL,
	"quantity" numeric(15, 3) NOT NULL,
	"rate" numeric(20, 2) NOT NULL,
	"total_value" numeric(20, 2) NOT NULL
);
