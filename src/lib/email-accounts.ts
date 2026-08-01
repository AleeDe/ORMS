import { createAdminClient } from "@/lib/supabase/admin";
import crypto from "crypto";

// Server-only. Resend API keys live in the database (so one user can connect
// several Resend accounts and pool their domains), encrypted with a secret that
// stays in the server environment. Ciphertext in the DB is useless on its own.
//
// NEVER import this into client code, and never return a decrypted key to the
// browser — the UI only ever sees `key_hint` ("re_…VYqM").

const ALGO = "aes-256-gcm";

function secret(): Buffer {
  const raw = process.env.ENCRYPTION_SECRET;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_SECRET is not set — add a 32+ character random string to .env.local"
    );
  }
  // Normalise any length of passphrase to a 32-byte key.
  return crypto.createHash("sha256").update(raw).digest();
}

/** iv:tag:ciphertext, base64, single string for storage. */
export function encryptKey(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, secret(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decryptKey(stored: string): string {
  const [ivB64, tagB64, dataB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Stored key is malformed");
  const decipher = crypto.createDecipheriv(ALGO, secret(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** "re_…VYqM" — safe to show in the UI. */
export function keyHint(key: string): string {
  return `re_…${key.slice(-4)}`;
}

/**
 * Decrypted key for one connected account. Server-side only, and it verifies the
 * account belongs to the given user before returning anything.
 */
export async function getAccountKey(
  accountId: string,
  userId: string
): Promise<string> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set on the server, so stored API keys cannot be read."
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("email_accounts")
    .select("api_key_encrypted, user_id, is_active")
    .eq("id", accountId)
    .maybeSingle();

  if (error) {
    throw new Error(
      /invalid api key|jwt/i.test(error.message)
        ? "SUPABASE_SERVICE_ROLE_KEY is wrong or missing on the server — stored API keys can't be read."
        : `Could not read the connected account: ${error.message}`
    );
  }
  if (!data) throw new Error("That Resend account is not connected.");
  if (data.user_id !== userId) throw new Error("That Resend account is not yours.");
  if (!data.is_active) throw new Error("That Resend account is disabled.");

  return decryptKey(data.api_key_encrypted as string);
}

/**
 * Resolves the key for whichever Resend account a domain was registered under.
 * This is what lets domains spread across several accounts all send correctly.
 */
export async function getKeyForDomain(
  domainId: string,
  userId: string
): Promise<string> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set on the server, so stored email settings cannot be read."
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("email_domains")
    .select("account_id, user_id")
    .eq("id", domainId)
    .maybeSingle();

  // A bad service-role key returns 401 here, which previously surfaced as the
  // misleading "Domain not found" — the row exists, we just couldn't read it.
  if (error) {
    throw new Error(
      /invalid api key|jwt/i.test(error.message)
        ? "SUPABASE_SERVICE_ROLE_KEY is wrong or missing on the server — email settings can't be read."
        : `Could not read email settings: ${error.message}`
    );
  }
  if (!data) throw new Error("Domain not found.");
  if (data.user_id !== userId) throw new Error("That domain is not yours.");

  return getAccountKey(data.account_id as string, userId);
}
