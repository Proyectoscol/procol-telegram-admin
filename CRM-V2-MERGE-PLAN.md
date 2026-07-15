# CRM v2 merge plan — folding Damian's build into the main project

Base: **this repo stays the base.** Nothing from `new-money-crm-code/` gets deployed
as-is — it's a reference implementation we're mining for the pieces that match
what the boss asked for in `boss conversation.md`. Damian's app runs on a
completely different stack (Prisma + SQLite/Turso, cuid string IDs) — we're
porting the *logic*, not the code, onto our stack (raw `pg` + Supabase Postgres,
integer `users.id`).

## What Damian's app actually has

| Feature | Where in his code | Matches boss's ask? |
|---|---|---|
| Opportunity Engine (deterministic rules, one score per member, 5 categories) | `src/lib/opportunities.ts`, `OpportunityScore` model | Yes — this is almost exactly what the boss described as the new homepage |
| Member roadmap (stage, goal, blocker, next action) | `src/lib/*`, `MemberRoadmap` model, `MemberRoadmapCard.tsx` | Yes — feeds the roadmap-update timeline entry |
| Sales/coaching layer: Wins, CoachNotes, FollowUps, SalesCalls | `Win`, `CoachNote`, `FollowUp`, `SalesCall` models | Yes — these are the "messages, coach notes, wins, calls" the AI profile should read |
| Review queue for unmatched import rows | `ImportReview` model, `review-queue/` pages | Not explicitly asked for, but directly enables "automate imports" — worth keeping |
| Import Center (Telegram JSON, group roster, payment/lifetime/premium/event lists, email, member update) | `src/lib/importCenter.ts`, `groupMembers.ts`, `emailImport.ts` | Yes — this is the deterministic matching pipeline that removes manual CRM upkeep |
| Tags (Payment Plan / Lifetime / Premium / Event Ticket) | `Tag` model | Partial overlap — our `users.is_premium` already covers "Premium"; tags add the rest |
| Member timeline | **Not actually built** — no timeline UI or event table in his code | Boss wants it; we have to build it from scratch either way |
| AI member profiles | **Not built** — no AI summary anywhere in his code | We already have this (`contact_personas` + `lib/ai/persona.ts`) — better than his |
| Teachable course-progress sync | **Not in the code he sent** (he mentioned a scraper exists separately) | New work, needs the scraper's output format |
| Welcome questionnaire import | **Not in the code he sent** | New work |
| Daily Telegram digest + input bot | **Not in either codebase** — his `lib/telegram.ts` is just JSON-file import parsing, not a live bot | Biggest genuinely-new piece of infra |

**Bottom line:** the CRM sales/opportunity/roadmap layer is the real, reusable
part of his build — it's a solid deterministic rules engine, well-suited to
port directly. Everything the boss called "the big stuff" (AI profiles,
timeline, Teachable, questionnaire, telegram bot) either doesn't exist yet in
his code either, or we already do it better. So this is not "whose CRM wins" —
it's "take his rules engine + data model, put it on our stack, then build the
5 things neither app has yet."

## What already exists on our side that we're reusing, not rebuilding

- **AI member profiles**: `contact_personas` table + `lib/ai/persona.ts` /
  `run-persona.ts` / `persona-queue.ts` already build a context blob from
  messages + reactions and generate an AI summary with buying-intent scoring.
  We extend the *context* this reads from (add wins/calls/notes/roadmap/course
  progress) — we don't rebuild the persona system.
- **Import pipeline**: `lib/ingest/ingest.ts` already does the Telegram-JSON
  import Damian's `telegram.ts` does, just against Postgres instead of SQLite.
  We port his **list-import matching logic** (payment/lifetime/premium/event/
  member-update lists + the review queue) as new code alongside it — his
  Telegram-JSON importer itself is redundant with ours.
- **`is_premium` / `is_current_member` / `member_since` / `notes`**: already on
  `users`. Damian's `premiumAccess`, `isCurrentMember`, `memberSince`, `notes`
  fields map straight onto these — no new columns needed for them.

## Schema changes (see `supabase-migration-crm-v2.sql` — paste it into the
Supabase SQL Editor and run it; every statement is `IF NOT EXISTS`, so it's
safe even if you re-run it)

1. **`users` gets new columns**: `status`, `offer_type`, `payment_status`,
   `amount_paid`, `status_override`, `left_at`, `birthday`, `tags` (JSONB),
   `email`. These are the CRM sales fields from his `Member` model that don't
   already exist on our `users`. `email` is new because Teachable sync and the
   email-list import both match by email and we don't currently store it.
2. **`import_batches` gets extra counter columns** (`kind`, `members_created`,
   `members_updated`, `tagged`, `unmatched`, `skipped`, `error_count`) so the
   same table can log list-imports, not just Telegram-JSON imports.
3. **New tables, all additive** (nothing existing is touched or dropped):
   - `import_reviews` — the review queue for import rows that couldn't be
     confidently matched.
   - `wins`, `coach_notes`, `follow_ups` — new tables for the sales/coaching
     layer. Sales calls reuse the existing `contact_calls` table instead of a
     new one (see below).
   - `member_roadmap` — one row per member: stage, goal, blocker, next action.
   - `opportunity_scores` — one row per member: the Opportunity Engine's
     output (score, category, reason, recommended action).
   - `member_events` — **new to both codebases.** An append-only log
     (`event_type`, `title`, `occurred_at`, `metadata`) that the member
     timeline page reads from. The app writes a row here whenever something
     timeline-worthy happens (a win logged, a call, a roadmap change, an
     import, course progress).
   - `questionnaire_responses` — structured welcome-questionnaire answers.
   - `course_progress` — Teachable sync target, matched by `email`.

## Two decisions made (confirmed with you directly)

**1. Tags: JSONB column on `users`, not a relational table.** Matches how this
codebase already stores small lists (`profile_photo_urls`, `buying_signals`) —
simpler to read/write than a join table at this member count, no real query
benefit lost.

**2. Sales calls: folded into the existing `contact_calls` table**, not a new
one. The old "10-call script" (`CHECK (call_number BETWEEN 1 AND 10)`,
`UNIQUE(user_id, call_number)`) is confirmed dead, so the migration drops that
cap and the uniqueness constraint, makes `call_number` optional, and adds the
missing fields (`current_situation`, `next_step`, `offer_discussed`,
`likelihood`, `follow_up_date`) so `contact_calls` becomes a single freeform,
unlimited call log. Existing numbered rows (1-10) are untouched — only the
constraints that stopped new freeform rows are relaxed.

## Net-new build (not a port from either codebase)

1. **Member timeline** — new UI + `member_events` table above.
2. **Teachable sync** — new import route that takes your scraper's output and
   upserts into `course_progress`, matched by `email`. I need the scraper's
   actual output shape (a sample JSON/CSV row) to build the matching/parsing
   — that's the one thing I can't derive from either codebase.
3. **Welcome questionnaire import** — new import route into
   `questionnaire_responses`, same list-import pattern as the others.
4. **Daily Telegram digest + input bot** — genuinely new infrastructure in
   both codebases: a Telegram Bot API webhook route (`/api/telegram/webhook`)
   for the input bot (free-text note → written into `coach_notes` with
   `note_type = 'TELEGRAM_BOT_INPUT'` + a `member_events` row), and a daily
   cron (Vercel Cron) that queries `opportunity_scores` and pushes a digest
   message to a Telegram chat. Needs a bot token from @BotFather and a
   decision on who's authorized to message the input bot.

## Build order (priority follows the boss's message directly)

1. ✅ Run the migration (`supabase-migration-crm-v2.sql`).
2. ✅ Port the Opportunity Engine rules (`opportunities.ts` logic → TypeScript
   against Postgres) + make it the new homepage (`/`, `lib/opportunities/engine.ts`).
3. ✅ Wire wins/coach-notes/follow-ups/roadmap/calls into the existing AI persona
   context builder (`lib/ai/persona.ts` — `buildCrmBlob`), so profiles auto-update
   from this data too.
4. ✅ Member timeline: `member_events` table, `lib/timeline.ts` (`logMemberEvent`
   / `getMemberTimeline`), and a `Timeline` section on the member profile page
   (`components/MemberCrm.tsx`). Wins, coach notes, follow-ups, and roadmap
   changes all log an event automatically and trigger an opportunity recompute.
   Also added the actual Wins / Coach Notes / Follow-ups / Roadmap CRUD UI —
   these didn't exist as editable forms anywhere yet, so the timeline had
   nothing to show without them. Bug fix along the way: the pre-existing
   "Calls" feature on the member page still enforced the old 1-10 numbered-call
   cap after the schema decision to make it freeform — fixed the API routes and
   UI to match.
5. ✅ Port the list-import + review-queue pipeline. Paste-a-list UI on the
   Import page (`lib/import/listImport.ts`, `/api/import/list` +
   `/api/import/list/preview`) for Payment Plan / Lifetime / Premium / Event
   Ticket / Email / Member Update lists — matches existing members by
   username → Telegram ID → email → exact name, applies tags/offer/payment
   fields, and never auto-creates a member. Unmatched or ambiguous rows go to
   a new `/review-queue` page (`/api/review-queue`) where you resolve to the
   right member (candidate buttons for same-name matches, or a live search)
   or skip. Skipped the Telegram-JSON and group-roster import types from
   Damian's version — this app already has those (`/api/ingest`,
   `/api/import/members`).
6. ✅ Questionnaire import. `lib/import/questionnaireImport.ts` — real CSV
   upload (quote-aware parsing, so answers containing commas parse
   correctly), columns matched by header keyword (not fixed position), age/
   location/goals/business/why-joined extracted automatically into
   `questionnaire_responses`, every column also kept in `raw_answers`
   regardless of match. Same member-matching as the list import, same review
   queue for anything unmatched. Refactored the shared matching logic
   (`lib/import/matching.ts`) out of the list importer so both use it instead
   of duplicating it, and moved review-queue resolution into
   `lib/import/reviewQueue.ts`, which now dispatches to the right importer's
   apply function based on the review row's import type.
7. Teachable sync (blocked on getting a sample export from the scraper).
8. Telegram bot (digest + input) — biggest lift, do last once the data model
   underneath it is stable.

Note: the member timeline only has events going forward from now — there's no
retroactive backfill of "joined the group" or historical import events into
`member_events`. Flag if you want that backfilled; it's a bigger job (has to
infer join dates from message/roster history per member).

## Not in scope for this pass

- Rebuilding Damian's Telegram-JSON importer (`telegram.ts`) — redundant with
  our existing `lib/ingest/ingest.ts`.
- Per-group (multi-chat) membership tracking (his `MemberGroup` model). Our
  `users.is_current_member` is a single global flag; his is per-group. The
  boss's ask doesn't call for per-group membership status, so I left this out
  — flag it if that's wrong and I'll add a `user_chat_membership` table.
