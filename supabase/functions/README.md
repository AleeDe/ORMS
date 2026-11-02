Workspace invitation email runs on Supabase when the app server has no Resend credentials. The Next.js route creates the invitation through the owner-only RPC, then invokes `workspace-invitation-email` with the signed-in owner's session and workspace scope. No new Netlify environment variables are needed.

The function verifies the user and workspace ownership, checks the stored invitation and token hash, and sends to the database's recipient using a trusted public URL. Accepted, revoked, expired and cross-workspace invitations cannot be sent. Successful sends are tracked server-side; retries use Resend's idempotency key. Email failures leave the shareable invitation link available.

To deploy, configure these values in the ignored root `.env.local`:

- `SUPABASE_ACCESS_TOKEN` with function and secrets write access
- `NEXT_PUBLIC_SUPABASE_URL`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` on a verified domain
- `WORKSPACE_INVITATION_APP_URL` with the public HTTPS app origin
- `WORKSPACE_INVITATION_EMAIL_ENABLED` (optional; defaults to `true`)

Run `node scripts/deploy-invitation-email.mjs` to validate the bundle, then `node scripts/deploy-invitation-email.mjs --apply` to configure the four invitation secrets and deploy the function. Other secrets and authentication email settings are preserved. The function uses Supabase's built-in server credentials, keeps JWT verification enabled, and verifies the current user inside the handler as well.

If Resend credentials are later added to the app server, it sends directly through the same email module instead. Set `WORKSPACE_INVITATION_EMAIL_ENABLED=false` on the app server to pause all invitation email, or on Supabase to pause the fallback.
