import {
  assertAuthorized,
  type AuthorizationActor,
  type AuthorizationDomain,
} from "./authorizationPolicy";

export const PROTECTED_ASSET_KINDS = [
  "attachment",
  "uploaded-file",
  "generated-export",
  "report-export",
] as const;

export type ProtectedAssetKind = (typeof PROTECTED_ASSET_KINDS)[number];
export type ProtectedAssetAction = "read" | "download" | "delete" | "generate";

export interface ProtectedAssetRecord {
  id: string | number;
  kind: ProtectedAssetKind;
  companyId: number;
  ownerUserId?: string | number | null;
  storageKey?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
  deletedAt?: string | Date | null;
}

export interface ProtectedAssetLookup {
  loadAsset(assetId: string | number, kind: ProtectedAssetKind): Promise<ProtectedAssetRecord | null>;
}

export interface ProtectedAssetAccessRequest {
  actor: AuthorizationActor | null | undefined;
  assetId: string | number;
  kind: ProtectedAssetKind;
  action: ProtectedAssetAction;
  domain?: AuthorizationDomain;
  requiredPermission: string;
  allowedRoles?: readonly string[];
  allowOwnerAccess?: boolean;
}

export interface ProtectedAssetAccessDecision {
  asset: ProtectedAssetRecord;
  safeFileName: string | null;
  disposition: "attachment";
}

export class ProtectedAssetAccessError extends Error {
  readonly code:
    | "ASSET_ID_INVALID"
    | "ASSET_NOT_FOUND"
    | "ASSET_COMPANY_INVALID"
    | "ASSET_STORAGE_KEY_INVALID"
    | "ASSET_FILE_NAME_INVALID"
    | "ASSET_SIZE_INVALID";

  constructor(code: ProtectedAssetAccessError["code"], publicMessage: "Not found" | "Forbidden" = "Not found") {
    super(publicMessage);
    this.name = "ProtectedAssetAccessError";
    this.code = code;
  }
}

function validIdentifier(value: unknown): boolean {
  return (
    (typeof value === "number" && Number.isSafeInteger(value) && value > 0) ||
    (typeof value === "string" && value.trim().length > 0 && value.length <= 200)
  );
}

function sameIdentity(left: string | number | null | undefined, right: string | number | null | undefined): boolean {
  return left != null && right != null && String(left) === String(right);
}

export function sanitizeDownloadFileName(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new ProtectedAssetAccessError("ASSET_FILE_NAME_INVALID");

  const normalized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]+/g, "-")
    .replace(/\.\.+/g, ".")
    .trim();

  if (!normalized || normalized === "." || normalized === ".." || normalized.length > 180) {
    throw new ProtectedAssetAccessError("ASSET_FILE_NAME_INVALID");
  }

  return normalized;
}

export function validateStorageKey(value: unknown): string {
  if (typeof value !== "string") throw new ProtectedAssetAccessError("ASSET_STORAGE_KEY_INVALID");
  const key = value.trim();
  if (
    !key ||
    key.length > 500 ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new ProtectedAssetAccessError("ASSET_STORAGE_KEY_INVALID");
  }
  return key;
}

export async function authorizeProtectedAssetAccess(
  lookup: ProtectedAssetLookup,
  request: ProtectedAssetAccessRequest
): Promise<ProtectedAssetAccessDecision> {
  if (!validIdentifier(request.assetId)) {
    throw new ProtectedAssetAccessError("ASSET_ID_INVALID");
  }

  const asset = await lookup.loadAsset(request.assetId, request.kind);
  if (!asset || asset.deletedAt) {
    throw new ProtectedAssetAccessError("ASSET_NOT_FOUND");
  }

  if (!Number.isSafeInteger(asset.companyId) || asset.companyId <= 0) {
    throw new ProtectedAssetAccessError("ASSET_COMPANY_INVALID");
  }

  if (asset.byteSize != null && (!Number.isSafeInteger(asset.byteSize) || asset.byteSize < 0)) {
    throw new ProtectedAssetAccessError("ASSET_SIZE_INVALID");
  }

  if (request.action !== "generate") validateStorageKey(asset.storageKey);
  const safeFileName = sanitizeDownloadFileName(asset.fileName);
  const ownerAllowed = request.allowOwnerAccess === true && sameIdentity(request.actor?.userId, asset.ownerUserId);

  assertAuthorized({
    actor: request.actor,
    domain: request.domain ?? "reporting",
    action: `asset.${request.kind}.${request.action}`,
    resource: { companyId: asset.companyId, ownerUserId: asset.ownerUserId ?? null },
    allowedRoles: ownerAllowed ? [request.actor!.role] : request.allowedRoles ?? [],
    requiredPermissions: ownerAllowed ? [] : [request.requiredPermission],
  });

  return { asset: Object.freeze({ ...asset }), safeFileName, disposition: "attachment" };
}

export function assertExportCompanyScope(sessionCompanyId: number, requestedCompanyId: unknown): number {
  if (!Number.isSafeInteger(sessionCompanyId) || sessionCompanyId <= 0) {
    throw new ProtectedAssetAccessError("ASSET_COMPANY_INVALID", "Forbidden");
  }
  const resolved = requestedCompanyId == null ? sessionCompanyId : Number(requestedCompanyId);
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved !== sessionCompanyId) {
    throw new ProtectedAssetAccessError("ASSET_COMPANY_INVALID", "Forbidden");
  }
  return resolved;
}
