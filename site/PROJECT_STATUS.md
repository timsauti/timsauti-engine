# TECH na PESA: Project status

Last updated: 2026-11-16

## Current phase and stage
- Phase: before Phase 1
- Stage: 1 (Audit) and 2 (Architecture) delivered for approval. Building Phase 1 waits for the owner's decisions below.
- Audit and architecture document: "TECH na PESA: Audit and Architecture" (shared doc).

## What is live today
- Static site at https://timsauti.github.io/timsauti-engine/ (GitHub Pages, deployed 2026-11-15, deployment status: success).
- Working without a database: 6 newsroom stories, Scam Checker, Money Tools (M-PESA calculator, EPRA fuel prices, daily exchange rates), sitemap, RSS.
- Built but not live (no database yet): accounts, community feed, comments, likes, ratings, challenges, judging.

## Recommended architecture (pending approval)
- Next.js + TypeScript app on Cloudflare Workers (Paid, USD 5/month).
- Supabase Pro (PostgreSQL + PostGIS, Auth, Storage, daily backups), separate staging and production.
- M-PESA Daraja STK Push through server routes; sandbox until Safaricom approves production.
- Existing social media agent connected through an adapter: GitHub workflow dispatch in, database records out. No replacement agent.

## Decisions and approvals needed from the owner
| Item | Owner action | Status |
| --- | --- | --- |
| Stack and running cost (about USD 30 to 45 a month) | Approve | Waiting |
| New private GitHub repository "technapesa" | Create it | Waiting |
| technapesa.com domain and DNS | Buy; give DNS access or move DNS to Cloudflare | Waiting |
| Paybill or Till for Timsauti Ltd | Apply with Safaricom | Waiting |
| Daraja production approval | Go live letter after sandbox tests | Not started |
| Data Commissioner (ODPC) registration | Register Timsauti Ltd | Not started |
| Meta Tech Provider verification (posting to clients' Pages) | Business verification in Meta | Not started |
| Prize challenges licence question | Advocate or Gambling Regulatory Authority | Challenges paused |

## Credentials still required (never pasted in chat; stored as server secrets)
- Supabase project URL, anon key, service key (staging and production)
- Daraja consumer key and secret, shortcode, passkey (sandbox first)
- GitHub fine grained token limited to dispatching the agent's workflow
- Email provider key; SMS provider key and sender name (later)

## Database changes and migrations
- None applied yet. Draft schema for community features: site/supabase/schema.sql (to be superseded by numbered migrations in the new repository).

## Testing
- Static site: builds and deploys; pages checked in a headless browser at phone and desktop sizes (2026-11-15).
- Phase 1 and Phase 2 acceptance tests: not started.

## Known issues
- The current site and the agent share one public repository (to be separated).
- No admin audit trail or backups yet (nothing stored yet).

## Next actions
1. Owner: decisions above.
2. Build milestone 1 (foundation): repository, staging database, accounts and roles, audit log, design system, admin shell.
