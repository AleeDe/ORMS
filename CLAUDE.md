@AGENTS.md

# Working on ORMS

## Current scope

Outbound email automation and its review queue were removed at the user's request.
Keep manual outreach logging, email contact details, follow-up tasks, analytics,
Google Calendar integration, and password recovery. Do not restore the removed
sending workflow unless requested.

The feature removal changes local application code. It does not delete remote
database records, cancel provider-held messages, or deploy the application.

## Campaign workflow

Dataset imports populate the shared lead library. Adding a lead to a campaign
creates a separate campaign_leads membership with fresh status and touch counts.
Re-adding a membership must preserve its existing progress.

Use lib/campaign-scope.ts for campaign URLs, scoped activity reads, membership
creation, and missing-next-step calculations. Campaign lead URLs carry a campaign
query parameter; legacy from=campaign: links are also supported. Outreach requires
a valid membership. Timelines, notes, tasks, touch counts, and status changes use
the active campaign; library-only history uses campaign_id IS NULL. Never fall
back to a different campaign or to unassigned outreach silently.

Contact details and people are shared master data. Log edits in the active
workspace, but do not duplicate the contact record per campaign. Existing
unassigned history remains in the library because its campaign cannot be inferred.

Campaigns can fix `default_channel` to one outreach channel, or leave it NULL for
per-touch selection. Keep legacy `clinic_email`/`clinic_phone` storage keys for
history; display them as Business email/Business number. The migration in
`supabase/migrations/20261025000001_campaign_outreach_channel.sql` adds this setting
and enforces it on new outreach inserts. Changing it must not rewrite history.
Quick-log reads the current saved channel and validates the linked person before
writing. A sole contact or unambiguous primary contact is preselected.

Campaign lead navigation uses the full campaign in newest-added-first order,
with membership id as a stable tie breaker, matching the campaign table before
filters. N advances and P goes back without wrapping. Ignore these shortcuts in
editable controls or open menus/dialogs, and block navigation while there is a
draft or pending save. Both navigation and membership loading must handle pages
beyond Supabase's default row limit.

Run npm test for campaign isolation regressions, npm run lint, and npm run build.
The Tasks screen uses `lib/tasks.ts` to fetch every page before deriving tab
counts. Always retain workspace/campaign filters and stable due-date/id ordering:
a single unpaginated response can hide future tasks behind older/completed rows.
`tests/campaign-channel.sql` verifies channel enforcement with rollback-only
fixtures against a migrated database.

## Team access

`20261025000002_campaign_teams.sql` adds memberships and campaign access.
`20261025000003_multiple_workspaces.sql` separates workspace IDs from account
IDs, preserving existing workspace IDs and record values. Each data record has
`workspace_id`; existing `user_id` columns remain the workspace owner's id.
Activities separately record `actor_id` and
`actor_name`; tasks record `created_by`, `assigned_to`, and `completed_by`.
Database triggers obtain these identities from the authenticated session.

Owners manage shared contacts, imports, campaign settings and invitations.
Members work only assigned campaigns and their own/unassigned tasks. Managers
can also assign and manage tasks in their campaigns. Viewers cannot write.
All reads, search, views and mutations must respect database RLS. Shared leads
must not reveal private campaign memberships or history.

App URLs live under `/w/[workspaceId]`. Use WorkspaceLink and the workspace
navigation hooks for internal app links; keep auth/join/directory URLs global.
Legacy app bookmarks redirect to a valid workspace. Explicit workspace URLs
never fall back to another company after access is revoked. The cookie only
remembers the last workspace for legacy entry URLs; it does not scope queries.

Use `useWorkspaceClient()` in app components. Its data client captures an
immutable workspace header and shares a single auth session, so another tab or
delayed save cannot change the request scope. Server queries use the route
header installed by Proxy. `orms_current_workspace()` independently validates
every scope; composite FKs forbid cross-workspace relationships. Caches and
drafts reset on workspace/actor/permission changes. Persistent filters and seen
notifications are partitioned by user and workspace. Use `useWorkspaceDraft`
for unsaved forms (and its pending argument for imports).
Composite FKs coexist with original cascade FKs: PostgREST embeds must name the
intended FK explicitly (for example `leads!tasks_lead_id_fkey(...)`).

Invitation tokens are hashed in storage, expire in seven days and can be used
once by the matching verified email. `/api/workspaces/[workspaceId]/invitations`
creates the invitation under the owner's RLS session and sends transactional
email through Resend, with a per-invitation idempotency key. Set server-only
`RESEND_API_KEY`, `RESEND_FROM_EMAIL` (verified sender), and `NEXT_PUBLIC_APP_URL`.
Invitation email sending is off by default. Set the server-only
`WORKSPACE_INVITATION_EMAIL_ENABLED=true` only when explicitly enabling it.
Otherwise invitations are shared by link, even when Resend credentials exist.
`WORKSPACE_INVITATION_APP_URL` optionally overrides the shared-link origin without
changing local Google Calendar OAuth callbacks (`NEXT_PUBLIC_APP_URL`).
Without delivery configuration, retain a shareable link and explicitly report
that no email was sent. The service-role client records delivery status only.
Replacement invites revoke older pending links; changing/removing access also
revokes that person's pending links. Accepting cannot overwrite newer campaign
permissions. Revocation preserves activity/completion history and releases open
assignments. Preserve FK cascade behavior when maintaining work guards.

Supabase Auth must require email confirmation (`mailer_autoconfirm=false`) so
invitation acceptance verifies control of the recipient address. Authentication
emails use Supabase's SMTP configuration, independently of invitation sending.
The auth callback supports both PKCE codes and token-hash templates and preserves
the invitation destination when sign-in must be retried. Allow localhost, the
current Netlify URL, and the custom domain in Auth redirect settings; shared links
use `WORKSPACE_INVITATION_APP_URL` or fall back to `NEXT_PUBLIC_APP_URL`.

Google Calendar tokens are partitioned by workspace and user. OAuth state is
opaque and bound to the authenticated account/workspace with an HttpOnly cookie;
callbacks revalidate membership before storing tokens. Events receive the
workspace explicitly from the originating action.

Run `tests/campaign-team-access.sql` as a database administrator to exercise real
authenticated owner/member/manager/viewer policies with rollback-only fixtures.
Run `tests/multiple-workspaces.sql` for same-owner isolation, existing-account
invitations, independent roles, workspace creation, and cross-company access.

## Database work

The application uses a remote Supabase database. Confirm the data owner and RLS
scope before interpreting empty results. Security-invoker functions that depend
on auth.uid() need the owning user's session; service-role calls can return an
empty result because auth.uid() is null.

When changing database objects:

- Recreate views that use SELECT * after adding columns to the source table.
- Use scalar variables when a conditional query might leave a record unassigned.
- Isolate per-row errors in batch work without hiding unexpected failures.
- Check every dependent function when changing a column type.

## Lead filters

`lead_filter_facts` is a plain view without the FK metadata required for an
embedded join. Query its matching lead ids separately and intersect them with
the main lead query. Both the lead library and campaign filters use this pattern;
do not restore the old `lead_filter_facts!inner` embed, which fails with PGRST200.

## Conventions

- Comments explain **why**, not what. Match the existing density — this codebase
  documents decisions and trade-offs, not syntax.
- Verify against the live DB and `npm run build` before claiming something works.
  "The code looks right" has been wrong more than once here; the last three bugs
  were all invisible in the source and only showed up in real data.
