/**
 * Pure helpers and lookup tables for the DataToolsTab page.
 *
 * Extracted from DataToolsTab.tsx during the Phase 4 god-file split.
 */
import {insertUserSchema, insertCompanySchema, insertUserCompanyRoleSchema} from "@shared/schema";

export const userFormSchema = insertUserSchema;

export const companyFormSchema = insertCompanySchema;

export const roleAssignmentSchema = insertUserCompanyRoleSchema.refine(
  (data) => {
    // If role is POS, assignedLocationId must be present
    if (data.role === "POS" && !data.assignedLocationId) {
      return false;
    }
    return true;
  },
  {
    message: "POS roles require an assigned location",
    path: ["assignedLocationId"],
  }
);
