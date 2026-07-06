import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";

const BCRYPT_SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}

export function isLegacySHA256Hash(hash: string): boolean {
  return hash.length === 64 && /^[a-f0-9]+$/i.test(hash);
}

export function verifyLegacyPassword(password: string, hash: string): boolean {
  const sha256Hash = CryptoJS.SHA256(password).toString().toLowerCase();
  return sha256Hash === (hash || "").toLowerCase();
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<{ valid: boolean; needsMigration: boolean }> {
  if (isLegacySHA256Hash(hash)) {
    const isValid = verifyLegacyPassword(password, hash);
    return { valid: isValid, needsMigration: isValid };
  }
  const isValid = await bcrypt.compare(password, hash);
  return { valid: isValid, needsMigration: false };
}
