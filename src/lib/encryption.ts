import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";

function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, 32);
}

function getSecret(): string {
  const secret = process.env.LINKEDIN_ENCRYPTION_KEY;
  if (!secret) throw new Error("LINKEDIN_ENCRYPTION_KEY not set");
  return secret;
}

export function encrypt(text: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(16);
  const key = deriveKey(getSecret(), salt);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${salt.toString("hex")}:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(data: string): string {
  const parts = data.split(":");
  const secret = getSecret();

  if (parts.length === 3) {
    // Legacy format: iv:tag:encrypted (fixed salt)
    const [ivHex, tagHex, encryptedHex] = parts;
    const key = scryptSync(secret, "salt", 32);
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  }

  // New format: salt:iv:tag:encrypted (random salt)
  const [saltHex, ivHex, tagHex, encryptedHex] = parts;
  const key = deriveKey(secret, Buffer.from(saltHex, "hex"));
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
