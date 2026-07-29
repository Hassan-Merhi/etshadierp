import { z } from "zod";

export const companyTypeSchema = z.enum([
  "erp",
  "factory",
  "factory_v2",
  "properties",
  "supplier_partner",
]);

export type CompanyType = z.infer<typeof companyTypeSchema>;

export const authenticatedUserSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  username: z.string().min(1),
  role: z.string().nullable().optional(),
  posStation: z.string().nullable().optional(),
}).passthrough();

export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;

export const userCompanyAssignmentSchema = z.object({
  companyId: z.coerce.number().int().positive(),
  companyCode: z.string().default(""),
  companyName: z.string().min(1),
  companyActive: z.boolean().default(true),
  role: z.string().optional(),
  companyType: companyTypeSchema.catch("erp"),
  displayCurrency: z.string().nullable().optional(),
}).passthrough();

export type UserCompanyAssignment = z.infer<typeof userCompanyAssignmentSchema>;

export const userCompaniesResponseSchema = z.array(userCompanyAssignmentSchema);

export const sessionCompanyResponseSchema = z.object({
  companyId: z.coerce.number().int().positive().nullable(),
});

export type SessionCompanyResponse = z.infer<typeof sessionCompanyResponseSchema>;

export function parseAuthenticatedUser(value: unknown): AuthenticatedUser | null {
  if (value === null || value === undefined) return null;
  const parsed = authenticatedUserSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid authenticated-user response");
  return parsed.data;
}

export function parseUserCompanies(value: unknown): UserCompanyAssignment[] {
  const parsed = userCompaniesResponseSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid user-companies response");
  return parsed.data;
}

export function parseSessionCompany(value: unknown): SessionCompanyResponse {
  const parsed = sessionCompanyResponseSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid session-company response");
  return parsed.data;
}
