// Server-only Resend helpers. Plain fetch against the REST API, matching how
// google-calendar.ts talks to Google (no SDK dependency).
//
// Every function takes an explicit API key rather than reading the environment,
// because a user may connect SEVERAL Resend accounts at once. A domain lives in
// exactly one account, so the key is resolved per-domain at call time
// (see lib/email-accounts.ts) — that is what lets domains spread across
// different Resend accounts all send correctly from one ORMS install.
//
// Resend is the AUTHORITY on verification: it generates the DKIM keypair, reads
// your DNS, and decides whether a domain may send. email_domains.status is only
// a cached copy of its answer.

const API = "https://api.resend.com";

export type ResendDnsRecord = {
  record: string; // "SPF" | "DKIM" | "Tracking"
  name: string;
  type: string; // "MX" | "TXT" | "CNAME"
  value: string;
  ttl?: string;
  priority?: number;
  status?: string;
};

export type ResendDomain = {
  id: string;
  name: string;
  status: string; // not_started | pending | verified | failed | temporary_failure
  region?: string;
  records?: ResendDnsRecord[];
};

async function call<T>(
  apiKey: string,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  if (!apiKey) throw new Error("No Resend API key for this account.");

  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};

  if (!res.ok) {
    // Resend errors come back as { name, message }.
    throw new Error(json?.message || `Resend ${res.status}: ${text.slice(0, 200)}`);
  }
  return json as T;
}

// --- Account -------------------------------------------------------------

/**
 * Lists the domains a key can see. Doubles as the connection test: a 401 means
 * the key is wrong, and the returned names tell the user which account this is.
 */
export function listDomains(apiKey: string) {
  return call<{ data: ResendDomain[] }>(apiKey, "/domains");
}

// --- Domains -------------------------------------------------------------

/** Registers a domain under the account this key belongs to. */
export function createDomain(apiKey: string, name: string, region = "us-east-1") {
  return call<ResendDomain>(apiKey, "/domains", {
    method: "POST",
    body: { name, region },
  });
}

/** Asks Resend to re-read DNS. Verification is async — status may lag. */
export function verifyDomain(apiKey: string, domainId: string) {
  return call<ResendDomain>(apiKey, `/domains/${domainId}/verify`, { method: "POST" });
}

/** Current server-side truth for one domain. */
export function getDomain(apiKey: string, domainId: string) {
  return call<ResendDomain>(apiKey, `/domains/${domainId}`);
}

// --- Sending -------------------------------------------------------------

export type SendEmailInput = {
  from: string; // "Sarah from ReviewYourDoctor <sarah@reviewyourdoctor.co.uk>"
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  /**
   * Resend message id of the previous email in this thread. Sent as In-Reply-To
   * and References so follow-ups stack under the original conversation in the
   * recipient's inbox instead of arriving as unrelated messages.
   */
  inReplyTo?: string;
  /**
   * ISO 8601 delivery time. Resend holds the message and delivers it then, so
   * reviewing at 9am can still land the email inside a 1pm–2pm outreach window.
   */
  scheduledAt?: string;
};

export async function sendEmail(apiKey: string, input: SendEmailInput) {
  const headers: Record<string, string> = {};
  if (input.inReplyTo) {
    // Resend message ids are bare uuids; RFC 5322 wants angle-bracketed ids.
    const mid = input.inReplyTo.startsWith("<") ? input.inReplyTo : `<${input.inReplyTo}>`;
    headers["In-Reply-To"] = mid;
    headers["References"] = mid;
  }

  return call<{ id: string }>(apiKey, "/emails", {
    method: "POST",
    body: {
      from: input.from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      reply_to: input.replyTo || undefined,
      headers: Object.keys(headers).length ? headers : undefined,
      scheduled_at: input.scheduledAt || undefined,
    },
  });
}

/**
 * Moves an already-scheduled email to a new delivery time.
 *
 * Verified against the live API: `PATCH /emails/:id` accepts `scheduled_at` and
 * rejects anything more than **30 days** out with a 422. Only works while the
 * email is still scheduled — once delivered there is nothing left to move.
 */
export function rescheduleEmail(apiKey: string, emailId: string, scheduledAt: string) {
  return call<{ id: string }>(apiKey, `/emails/${emailId}`, {
    method: "PATCH",
    body: { scheduled_at: scheduledAt },
  });
}

/**
 * Cancels a scheduled email so it never goes out. Resend answers 404 once the
 * message has already been delivered, which callers should treat as "too late"
 * rather than as an error worth surfacing raw.
 */
export function cancelEmail(apiKey: string, emailId: string) {
  return call<{ id: string }>(apiKey, `/emails/${emailId}/cancel`, { method: "POST" });
}

/** "Display Name <local@domain>" — the form Resend expects for `from`. */
export function formatFrom(displayName: string, address: string) {
  return displayName ? `${displayName} <${address}>` : address;
}
