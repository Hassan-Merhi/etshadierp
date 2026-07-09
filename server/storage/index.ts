// NOTE: auth.ts and accounting.ts both define permission/settings helpers with
// identical names (getSystemSetting, getRoleFeaturePermission(s), etc).
// This barrel is not the runtime storage object (see server/storage.ts, which
// merges these modules via object spread with accounting.ts winning for the
// shared names). To keep this barrel's types unambiguous without changing
// which implementation wins, auth's exports are listed explicitly, excluding
// the names accounting.ts also exports.
export {
  getUser,
  getUserByUsername,
  createUser,
  getAllUsers,
  updateUser,
  deleteUser,
  getUserCompanyRole,
  getAllCompanies,
  getCompanyById,
  createCompany,
  updateCompany,
  deleteCompany,
  getUserCompaniesWithRoles,
  createUserCompanyRole,
  updateUserCompanyRole,
  deleteUserCompanyRole,
} from "./auth";
export * from "./accounting";
export * from "./inventory";
export * from "./stockOps";
export * from "./containers";
export * from "./suppliers";
export * from "./employees";
export * from "./pos";
export * from "./factory";
