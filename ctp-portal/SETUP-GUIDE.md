# Clear Tech Partner Portal — Setup Guide

What you're deploying: **portal.cleartechpartner.com** — client portal + internal dashboard with the Content Studio built in. One codebase, two experiences, fully bilingual (EN/ES).

**Total time: ~45–60 min. Total cost: ~€20–40/month** (mostly Anthropic API usage; Supabase, Netlify and Resend free tiers cover you for a long time).

You'll create 3 accounts: Supabase (database + logins + file storage), Anthropic (AI for studio + translation), Resend (sends emails from client@cleartechpartner.com).

---

## Step 1 — Supabase (~15 min)

1. Go to **supabase.com** → Sign up (use your EXISTA/CTP Google account) → **New project**
   - Name: `ctp-portal` · Region: **EU (Frankfurt or Paris)** · Set a strong database password (save it in 1Password — you rarely need it again)
2. Once the project is ready, open **SQL Editor** (left sidebar) → **New query** → paste the entire contents of `supabase/schema.sql` from this folder → **Run**. You should see "Success. No rows returned."
3. **Authentication → URL Configuration**:
   - Site URL: `https://portal.cleartechpartner.com`
   - Redirect URLs → add: `https://portal.cleartechpartner.com/welcome`
4. **Authentication → Sign In / Providers**: make sure **Email** is enabled. Turn **OFF** "Allow new users to sign up" (you invite everyone — no self-signup).
5. **Project Settings → API** — copy these 3 values into a note (you'll paste them into Netlify in Step 4):
   - Project URL
   - `anon` public key
   - `service_role` key (secret — never goes in frontend code; here it only lives in Netlify env vars)

## Step 2 — Anthropic API key (~5 min)

1. **console.anthropic.com** → sign up → **Billing** → add a card, load $10 credit
2. **API Keys** → Create key → name it `ctp-portal` → copy it
3. Expected usage: studio content + report translations ≈ **$5–15/month**

## Step 3 — Resend (email) (~10 min)

1. **resend.com** → sign up → **Domains** → Add `cleartechpartner.com`
2. Resend shows you 3 DNS records (SPF, DKIM, MX for bounces). Add them wherever your cleartechpartner.com DNS lives (same place as your Netlify site domain settings — likely your registrar).
3. Wait for "Verified" (minutes to a few hours).
4. **API Keys** → Create → copy it.
5. Sender will be `client@cleartechpartner.com` — no mailbox needed for *sending*; but make sure that address can *receive* replies (add it as an alias/mailbox in your Google Workspace).

*Skip-ahead option: everything works without Resend — invites give you a link to send manually. Add Resend whenever.*

## Step 4 — Deploy to Netlify (~15 min)

1. Put this folder in a **GitHub repo** (private):
   ```
   cd ctp-portal
   git init && git add -A && git commit -m "CTP portal v1"
   ```
   Then create a private repo on github.com and push (GitHub shows you the 2 commands).
2. **app.netlify.com** → **Add new site → Import an existing project** → pick the repo. Build settings auto-detect from `netlify.toml`. Don't deploy yet —
3. **Site configuration → Environment variables** → add all of these (values from Steps 1–3):

   | Key | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | your Supabase Project URL |
   | `VITE_SUPABASE_ANON_KEY` | anon key |
   | `SUPABASE_URL` | same Project URL |
   | `SUPABASE_ANON_KEY` | same anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
   | `ANTHROPIC_API_KEY` | sk-ant-... |
   | `RESEND_API_KEY` | re_... (skip if no Resend yet) |
   | `CLIENT_FROM_EMAIL` | `Clear Tech Partner <client@cleartechpartner.com>` |
   | `INTERNAL_NOTIFY_EMAIL` | `rainy@cleartechpartner.com` |
   | `SITE_URL` | `https://portal.cleartechpartner.com` |

4. **Deploy site.**
5. **Domain management → Add domain** → `portal.cleartechpartner.com`. Netlify gives you a CNAME — add it in your DNS. HTTPS is automatic.

## Step 5 — Create YOUR login (~2 min)

Supabase → **Authentication → Users → Add user → Create new user**
- Email: `rainy@cleartechpartner.com` · set a password · check "Auto confirm user"

The @cleartechpartner.com domain automatically makes you **internal** — you land on the dashboard with Content Studio. Anyone else lands on the client portal. That's the whole access model.

## Step 6 — First clients (~10 min, inside the portal)

1. Sign in at portal.cleartechpartner.com
2. **New client** → Hotel Ses Bruixes & Spa → language **ES or EN** (Anya's call) → then in the client page add projects: *Guida night agent* (live), *Verification layer* — and note the partner discount in internal notes.
3. **New client** → Casa Bárbara → type "Independent owner" → project: *Website form → dynamic booking* (planned).
4. When ready: client page → **Access tab** → invite Anya. She gets a branded welcome email and sets her own password. Banking/routing details stay in 1Password — the portal never stores them.

## Step 7 — Restore your Content Studio backup (~2 min)

Content Studio → **Settings → Backup & portability → Import** → paste the contents of `ctp-studio-backup-2026-06-10.json` from your desktop. Your knowledge base, voices and library come back exactly as they were — now stored in your own database.

---

## How the bilingual system works (your scalable solution)

- You set each client's portal language when you create them. They can also change it themselves in their Profile.
- **You always work in English.** When you publish a report for a Spanish-language client, the portal auto-translates (peninsular Spanish, professional-warm) and stores BOTH versions. There's also a "Translate to Spanish" button in the composer so you can review/edit the Spanish before publishing.
- Clients see everything in their language, with an EN/ES toggle on every report.
- Update log entries auto-translate the same way.
- Notification emails arrive in the client's language, from client@cleartechpartner.com.

## What's wired for Phase 2 (not built yet)

- **WhatsApp notifications**: every event already fires to a `PIPEDREAM_WEBHOOK_URL` env var if you set one. Add a Pipedream workflow later — zero code changes here.
- **Report automation agent** (parses Guida logs → drafts the monthly report): end-of-month session.
- Guida metrics dashboard, Stripe pay-now on invoices, Google Drive sync.

## If something breaks

- **Invite email never arrives** → Resend domain not verified yet; use the manual link the Access tab gives you.
- **"Internal access only" errors** → you're signed in with a non-@cleartechpartner.com account.
- **Client sees nothing** → their profile isn't linked to a client record; re-invite from the Access tab (the invite carries the link).
- Redeploys: push to GitHub → Netlify rebuilds automatically.
