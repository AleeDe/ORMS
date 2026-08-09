@AGENTS.md

# Working on ORMS

`../PROJECT_CONTEXT.md` is the source of truth for *what* was built and why. This
file covers *how to work on it* — the things that are not visible in the code and
that cost real time to rediscover.

## The one rule that explains the email feature

**ORMS prepares emails; a human sends them.** Nothing in this codebase transmits
mail on a timer. Auto-*scheduling* is in; auto-*sending* is deliberately out, and
that distinction is the whole product. If you are ever tempted to add a cron that
sends, re-read this line — the "no cron" design is intentional, not an omission.

The consequence: `materialize_due_emails()` is called from the **client on page
load** (`/emails`), not by a scheduler. It is idempotent so that is safe.

## The pipeline, end to end

Understanding the chain matters because a break anywhere shows up as the same
symptom — "the workflow does nothing":

```
email_sequences (is_active) → email_sequence_steps (position, delay_days)
  ↓ enrol (lead detail card, or whole campaign via /api/email/enroll-campaign)
email_enrollments (status=active, current_step, next_due_at, sender pinned)
  ↓ materialize_due_emails()   ← client-side, on /emails load, idempotent
email_queue (status=ready)  → shown in Ready to Review
  ↓ human clicks Send → /api/email/send
Resend (scheduledAt = the outreach window)
  ↓
status='approved' (handed over, not delivered) → webhook → 'sent'
```

`approved` ≠ `sent`. Approved means Resend has it and will deliver it inside the
window. That's why the queue page has a separate **Scheduled** tab.

### Where each piece of state lives
- `email_enrollments.next_due_at` — when the *next step* is due (timestamptz).
- `email_queue.due_date` — the date the step was materialised for (**date**).
- `email_queue.scheduled_at` — when Resend will actually deliver it (timestamptz).
- `email_send_log` — append-only, the **only** correct source for "how many did we
  send". Never count `email_queue` for capacity; its rows get edited, cancelled
  and re-materialised.

## Debugging: how to actually inspect the live database

There is no local Supabase. The database is remote and populated, so reason about
real rows rather than guessing.

**`supabase db push` does not work here** — it needs `SUPABASE_DB_PASSWORD`, which
is not in `web/.env.local` (that file has only the URL, anon key, service-role key
and `ENCRYPTION_SECRET`).

To run DDL, use the management API **with a CLI user-agent** — a bare request gets
a Cloudflare `403 error code: 1010` that looks exactly like an auth failure:

```bash
curl -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
     -H "User-Agent: supabase-cli" \
     -H "Content-Type: application/json" \
     -d '{"query":"<sql>"}' \
  https://api.supabase.com/v1/projects/yvclpdwtzwlphazwsnaw/database/query
```

To read data, hit PostgREST with the service-role key from `web/.env.local`.

### The trap that will waste your time

Most of these RPCs are `security invoker` and filter on `auth.uid()`. **Calling
them with the service-role key returns 0 and no error** — `auth.uid()` is null, so
nothing matches, and a broken function looks like an empty result set.

Always test as the *owning user*. Mint a session without needing a password:

```bash
# admin/generate_link → hashed_token, then exchange it at /auth/v1/verify
POST /auth/v1/admin/generate_link  {"type":"magiclink","email":"<user>"}
POST /auth/v1/verify               {"type":"magiclink","token_hash":"<hashed_token>"}
```

Running `materialize_due_emails()` this way is what surfaced the real error; as
service role it had silently returned `0` for weeks.

**Whose data is it?** RLS scopes everything per user, and this project has four
auth users with data split across them. As of 2026-08-05 the email-sequence data
(domains, sequences, 21 enrollments) belongs to **`saaamiboy@gmail.com`**, while
`shiftdeploy@gmail.com` holds a different lead set. Querying the wrong user shows
an empty, healthy-looking app. Confirm the owner before concluding anything.

## Postgres gotchas that have already bitten this codebase

1. **`create view ... select q.*` freezes the column list at creation time.**
   Adding a column to the table later does *not* add it to the view. Any migration
   that adds a column to `email_queue` must also re-run `create or replace view
   email_queue_detail`, or the UI silently receives `undefined`. This is exactly
   why delivery times stopped showing in the Scheduled tab.

2. **An unassigned plpgsql `record` is not a record of nulls.** A conditional
   `select ... into rec` inside an `if` leaves `rec` *unassigned* on the other
   branch, and merely reading `rec.field` raises `55000`. Use scalar variables
   when the select is conditional. This killed the entire queue: campaign
   enrolment pins `person_id = null`, so every row hit it.

3. **One uncaught error aborts an entire plpgsql loop.** `materialize_due_emails()`
   processes many enrollments; wrap the per-row work in `begin ... exception` so a
   single bad lead is skipped and warned about instead of emptying the queue for
   everyone. Batch loops here should always isolate per iteration.

4. **Widening a column does not update functions that use it.** `next_due_at`
   became `timestamptz` in `20260801000001` while `email_queue.due_date` stayed a
   `date`; the function comparing them was never revised. When you change a column
   type, grep for every function that touches it.

## Resend

- A **domain lives in exactly one Resend account**, so there is no single env key.
  Keys live in `email_accounts` (AES-256-GCM, `ENCRYPTION_SECRET`) and are resolved
  per-domain via `lib/email-accounts.ts`. `RESEND_API_KEY` is not used anywhere —
  do not reintroduce it.
- Resend answers **`500 "Something went wrong"`** — not 401/403 — when a key lacks
  permission for management endpoints. A *Sending access* key sends mail fine but
  fails every `/domains` call. Diagnose: `/emails` works (key alive) but `/domains`
   500s (needs Full access).
- Sends are spread across the outreach window rather than fired at once; a burst of
  identical timestamps reads as automation and a young domain cannot afford that.
  Warm-up is per **domain** and starts at the first real send, not at verification.

## OPEN TASKS (requested 2026-08-05, not yet started)

Five gaps the user reported after the queue was unblocked. Investigated and
root-caused already — the findings below are verified against the live DB, so
trust them and skip re-diagnosis. Tick items off here as they land.

### 1. Scheduled tab shows no delivery time — [ ]
The UI prints "Due 2026-08-03" instead of when the email actually goes out.
**Not a UI bug.** `email_queue.scheduled_at` is correctly populated (verified:
09:00, 10:00, 10:20 UTC, properly spread across the window). The problem is
gotcha #1 above — `email_queue_detail` was created with `select q.*` *before*
`scheduled_at` and `approved_at` existed, so the view never exposed them and
[emails/page.tsx](src/app/(app)/emails/page.tsx) reads `undefined`.

Fix: a migration that re-runs `create or replace view email_queue_detail`
(definition at the end of `20260729000001_email_sequences.sql`). Confirm with
`select scheduled_at from email_queue_detail limit 1` — it currently errors with
`42703 column does not exist`. The page already has the render logic and
`formatSlot()`, so no client changes should be needed.

### 2. Campaigns should show which sequence a lead is already in — [ ]
Currently you cannot tell from the campaign screens that leads are mid-sequence,
so it is easy to enrol them twice. Surface the enrolment on the campaign detail
table (and ideally a count on the campaign card): sequence name + status +
current step. Data is in `email_enrollments` (`campaign_id`, `sequence_id`,
`status`, `current_step`), joinable to `email_sequences.name`.

### 3. No way to delete a sequence — [ ]
`email_senders` and `email_sequence_steps` both have delete buttons in
[settings/email/page.tsx](src/app/(app)/settings/email/page.tsx); sequences only
have an is_active toggle, so dead test sequences ("sample", "Review", "Review
Your Doctor A") pile up forever. Add delete on `SequenceCard`.
**Check the FK behaviour on `email_enrollments.sequence_id` first** — deleting a
sequence that has enrollments must not cascade away history. If it would, block
the delete with a clear message and offer archiving instead.

### 4. Per-email send time — [ ]
The user asked "send timing kis se link hai?". Today it is **only** global:
`settings.outreach_start_time`/`end_time`/`timezone` + `schedule_in_window`, fed
through `nextSendSlot()` in [lib/send-window.ts](src/lib/send-window.ts) at the
moment of approval. There is no per-email override anywhere.

Constraints to respect:
- `lib/resend.ts` has **no cancel/reschedule helper** — `sendEmail` only creates.
  Once handed to Resend with a `scheduled_at`, changing the time means calling
  Resend's cancel/update endpoint, which must be added there first.
- Easiest correct shape: let the user pick a time *before* approving (a per-row
  override that feeds `nextSendSlot`), rather than editing an already-approved
  email. Store it on `email_queue` (e.g. `scheduled_at_override timestamptz`).
- Keep the spread-out behaviour — do not let overrides bunch sends into one
  instant; see the burst warning in the Resend section.

### 5. Campaign detail needs the Leads-page filters — [ ]
The campaign detail table only filters by the 8-state status
([campaigns/[id]/page.tsx:165](src/app/(app)/campaigns/[id]/page.tsx#L165)),
while `/leads` has search + email/website/phone/people/campaign/custom-field
filters. Port that filter bar so a campaign can be sliced the same way. Reuse the
existing leads filter code rather than duplicating it — note the anti-join
pattern (`emf:lead_emails()` + `is('emf', null)`) documented in PROJECT_CONTEXT.

## Conventions

- Comments explain **why**, not what. Match the existing density — this codebase
  documents decisions and trade-offs, not syntax.
- Verify against the live DB and `npm run build` before claiming something works.
  "The code looks right" has been wrong more than once here; the last three bugs
  were all invisible in the source and only showed up in real data.
