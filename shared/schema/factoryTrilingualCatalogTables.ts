import { sql } from "drizzle-orm";
import {
  boolean,
  decimal,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const factoryCategories = pgTable(
  "factory_categories",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    nameAr: varchar("name_ar", { length: 100 }),
    nameFr: varchar("name_fr", { length: 100 }),
    isActive: boolean("is_active").notNull().default(true),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueCompanyName: uniqueIndex("factory_categories_company_name_unique").on(table.companyId, table.name),
  })
);

export const insertFactoryCategorySchema = createInsertSchema(factoryCategories)
  .omit({ id: true, createdAt: true, updatedAt: true, deletedAt: true })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    name: z.string().min(1, "Category name is required"),
    nameAr: z.string().optional().nullable(),
    nameFr: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
  });

export type InsertFactoryCategory = z.infer<typeof insertFactoryCategorySchema>;
export type FactoryCategory = typeof factoryCategories.$inferSelect;

export const factoryBaleProducts = pgTable(
  "factory_bale_products",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    code: varchar("code", { length: 50 }).notNull(),
    articleCode: varchar("article_code", { length: 50 }),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    nameFr: text("name_fr"),
    description: text("description"),
    descriptionAr: text("description_ar"),
    descriptionFr: text("description_fr"),
    weightPerBaleKg: decimal("weight_per_bale_kg", { precision: 10, scale: 2 }),
    categoryId: integer("category_id"),
    sellingPrice: decimal("selling_price", { precision: 20, scale: 2 }).default("0"),
    productionPrice: decimal("production_price", { precision: 20, scale: 2 }).default("0"),
    labelDesignColor: varchar("label_design_color", { length: 20 }),
    active: boolean("active").notNull().default(true),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueCompanyCode: uniqueIndex("factory_bale_products_company_code_unique").on(table.companyId, table.code),
    uniqueCompanyArticleCode: uniqueIndex("factory_bale_products_company_article_code_unique").on(
      table.companyId,
      table.articleCode
    ),
    normalizedCompanyArticleCode: index("factory_bale_products_company_article_code_normalized_idx").using(
      "btree",
      table.companyId,
      sql`upper(btrim(${table.articleCode}))`
    ),
  })
);

export const insertFactoryBaleProductSchema = createInsertSchema(factoryBaleProducts)
  .omit({ id: true, createdAt: true, updatedAt: true, deletedAt: true })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    code: z.string().optional(),
    articleCode: z.string().optional().nullable(),
    name: z.string().min(1, "Product name is required"),
    nameAr: z.string().optional().nullable(),
    nameFr: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    descriptionAr: z.string().optional().nullable(),
    descriptionFr: z.string().optional().nullable(),
    weightPerBaleKg: z.string().optional().nullable(),
    sellingPrice: z.string().optional().nullable(),
    productionPrice: z.string().optional().nullable(),
    categoryId: z.number().optional().nullable(),
    labelDesignColor: z.string().optional().nullable(),
    active: z.boolean().optional(),
  });

export type InsertFactoryBaleProduct = z.infer<typeof insertFactoryBaleProductSchema>;
export type FactoryBaleProduct = typeof factoryBaleProducts.$inferSelect;
