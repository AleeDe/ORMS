export function normalizeWebsite(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

export function normalizeName(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return n || null;
}

export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const p = phone.replace(/[^0-9+]/g, "");
  return p || null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmailSyntax(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  return e || null;
}
