import { queryWithRetry, ensureSchema } from '@/lib/db/client';

/**
 * The Opportunity Engine: a deterministic rules engine (no AI) that assigns
 * each member their single most important "opportunity" — the next action
 * an admin should take. One row in opportunity_scores per member; the
 * highest-scoring rule wins. Ported from new-money-crm-code's
 * src/lib/opportunities.ts onto this project's Postgres schema.
 */

export type OppCategory = 'SALES' | 'SUCCESS' | 'COMMUNITY' | 'TESTIMONIAL' | 'RISK';

// Display order on the homepage (Success sits at the lower end).
export const OPP_CATEGORIES: OppCategory[] = ['SALES', 'RISK', 'TESTIMONIAL', 'COMMUNITY', 'SUCCESS'];

export const OPP_META: Record<OppCategory, { emoji: string; title: string; blurb: string }> = {
  SALES: { emoji: '🔥', title: 'Sales Opportunities', blurb: 'Members most likely to buy' },
  SUCCESS: { emoji: '🎯', title: 'Success Opportunities', blurb: 'Members who need coaching attention' },
  COMMUNITY: { emoji: '❤️', title: 'Community Opportunities', blurb: 'Relationship & welcome touches' },
  TESTIMONIAL: { emoji: '⭐', title: 'Testimonial Opportunities', blurb: 'Wins worth capturing' },
  RISK: { emoji: '⚠️', title: 'Risk Opportunities', blurb: 'Members at risk — act now' },
};

const DAY_MS = 24 * 60 * 60 * 1000;

interface Ctx {
  offerType: string;
  paymentStatus: string;
  status: string;
  premiumAccess: boolean;
  /** The persisted is_lifetime column — a distinct product Premium members are also granted, but not vice versa. */
  lifetimeAccess: boolean;
  amountPaid: number | null;
  overallMessageCount: number;
  isCurrentMember: boolean;
  membershipRemoved: boolean;
  daysSinceActive: number; // Infinity if never
  daysSinceJoined: number | null;
  birthdayInDays: number | null;
  tags: Set<string>;
  stage: string | null;
  roadmapOverdue: boolean;
  winCount: number;
  daysSinceWin: number | null;
  maxWinAmount: number | null;
  daysSinceCoach: number | null;
  overdueFollowUp: boolean;
  followUpDueSoon: boolean;
  testimonialSnippet: string | null;
}

// High-signal phrases that suggest a member posted something testimonial-worthy.
// Deterministic keyword match (not AI) — the snippet is shown so an admin verifies.
const TESTIMONIAL_PATTERNS = [
  'first client',
  'first sale',
  'closed my first',
  'signed my first',
  'made my first',
  'my first win',
  'first payment',
  'changed my life',
  'life changing',
  'life-changing',
  'best decision',
  'quit my job',
  'financial freedom',
  'hit my goal',
  'goal reached',
  'first 10k',
  '10k month',
  'closed a deal',
  'closed a client',
];

interface Match {
  category: OppCategory;
  score: number;
  reason: string;
  recommendedAction: string;
}

const isPaying = (c: Ctx) =>
  c.premiumAccess ||
  (c.amountPaid != null && c.amountPaid > 0) ||
  ['PREMIUM', 'LIFETIME', 'PAYMENT_PLAN', 'DEPOSIT', 'COACHING_ACCESS', 'MASTERMIND'].includes(c.offerType) ||
  ['PAID', 'PAYMENT_PLAN'].includes(c.paymentStatus) ||
  c.tags.has('Premium') ||
  c.tags.has('Lifetime') ||
  c.tags.has('Payment Plan');

// Premium implies Lifetime (enforced at write time — turning Premium on always
// cascades to Lifetime), but Lifetime does NOT imply Premium — someone can hold
// the Lifetime product without being in the Premium group. One-directional.
const hasPremium = (c: Ctx) => c.offerType === 'PREMIUM' || c.premiumAccess || c.tags.has('Premium');
const hasLifetime = (c: Ctx) => c.lifetimeAccess || c.offerType === 'LIFETIME' || c.tags.has('Lifetime');

// Each rule returns a Match or null. All are evaluated; the highest score wins.
const RULES: ((c: Ctx) => Match | null)[] = [
  // ── RISK ──────────────────────────────────────────────────────────────────
  (c) =>
    c.paymentStatus === 'OVERDUE'
      ? { category: 'RISK', score: 96, reason: 'Payment is overdue', recommendedAction: 'Reach out about the overdue balance and collect payment' }
      : null,
  (c) =>
    c.membershipRemoved && isPaying(c)
      ? { category: 'RISK', score: 90, reason: 'Paid member who left the group', recommendedAction: 'Win-back call — find out why they left' }
      : null,
  (c) =>
    isPaying(c) && c.daysSinceActive >= 30 && c.daysSinceActive < 9000
      ? { category: 'RISK', score: 85, reason: `Paying member inactive ${Math.round(c.daysSinceActive)}d`, recommendedAction: 'Re-engage before they churn' }
      : null,
  (c) =>
    c.overdueFollowUp
      ? { category: 'RISK', score: 80, reason: 'A follow-up is overdue', recommendedAction: 'Complete the overdue follow-up now' }
      : null,
  // NOTE: purely-inactive members (no activity for a long time, no other signal)
  // are intentionally NOT surfaced — they're not actionable work. Only *paying*
  // members going quiet are flagged (the rule above), as a churn risk.

  // ── SUCCESS ─────────────────────────────────────────────────────────────────
  (c) =>
    c.roadmapOverdue && c.stage !== 'WON'
      ? { category: 'SUCCESS', score: 71, reason: 'Behind on their roadmap due date', recommendedAction: 'Coaching check-in — get them back on track' }
      : null,
  (c) =>
    c.followUpDueSoon
      ? { category: 'SUCCESS', score: 68, reason: 'A follow-up is due soon', recommendedAction: 'Action the upcoming follow-up' }
      : null,
  (c) =>
    c.stage === 'AT_RISK'
      ? { category: 'SUCCESS', score: 66, reason: 'Roadmap marked at-risk', recommendedAction: 'Give this member coaching attention' }
      : null,

  // ── TESTIMONIAL ────────────────────────────────────────────────────────────
  (c) =>
    c.stage === 'WON'
      ? { category: 'TESTIMONIAL', score: 74, reason: 'Reached the WON stage', recommendedAction: 'Ask for a testimonial / case study' }
      : null,
  (c) =>
    c.maxWinAmount != null && c.maxWinAmount >= 5000
      ? { category: 'TESTIMONIAL', score: 70, reason: `Posted a ${c.maxWinAmount.toLocaleString()} win`, recommendedAction: "Request a testimonial while it's fresh" }
      : null,
  (c) =>
    c.winCount === 1 && c.daysSinceWin != null && c.daysSinceWin <= 30
      ? { category: 'TESTIMONIAL', score: 64, reason: 'Logged their first win', recommendedAction: 'Capture their story / first milestone' }
      : null,
  (c) =>
    c.testimonialSnippet
      ? {
          category: 'TESTIMONIAL',
          score: 62,
          reason: `Posted: "${c.testimonialSnippet}"`,
          recommendedAction: 'Read the message and ask for a testimonial',
        }
      : null,

  // ── SALES ──────────────────────────────────────────────────────────────────
  // Reverse upsell: Premium always implies Lifetime, so this can only fire for
  // someone who holds Lifetime on its own, without Premium.
  (c) =>
    hasLifetime(c) && !hasPremium(c) && c.daysSinceActive <= 30
      ? { category: 'SALES', score: 78, reason: 'Lifetime member, not yet in Premium', recommendedAction: 'Pitch Premium access' }
      : null,
  (c) =>
    c.daysSinceWin != null && c.daysSinceWin <= 21 && isPaying(c)
      ? { category: 'SALES', score: 76, reason: 'Recently posted a win', recommendedAction: 'Strike while hot — offer the next step' }
      : null,
  (c) =>
    (c.paymentStatus === 'PAYMENT_PLAN' || c.offerType === 'PAYMENT_PLAN') && c.daysSinceActive <= 30
      ? { category: 'SALES', score: 66, reason: 'On a payment plan & engaged', recommendedAction: 'Offer paid-in-full or an upgrade' }
      : null,
  (c) =>
    c.daysSinceJoined != null && c.daysSinceJoined <= 90 && c.daysSinceActive <= 14 && !isPaying(c) && c.offerType === 'UNKNOWN'
      ? { category: 'SALES', score: 72, reason: 'New, active, no offer yet', recommendedAction: 'Pitch the core offer' }
      : null,
  (c) =>
    isPaying(c) && c.daysSinceActive <= 30 && (c.daysSinceCoach == null || c.daysSinceCoach >= 45)
      ? { category: 'SALES', score: 58, reason: 'Engaged, no coach contact recently', recommendedAction: 'Reach out and book a call' }
      : null,

  // ── COMMUNITY ──────────────────────────────────────────────────────────────
  (c) =>
    c.birthdayInDays != null && c.birthdayInDays <= 3
      ? { category: 'COMMUNITY', score: 82, reason: c.birthdayInDays === 0 ? 'Birthday is today' : `Birthday in ${c.birthdayInDays}d`, recommendedAction: 'Send birthday wishes' }
      : null,
  (c) =>
    c.daysSinceJoined != null && c.daysSinceJoined <= 30 && c.overallMessageCount < 2
      ? { category: 'COMMUNITY', score: 56, reason: "New but hasn't engaged yet", recommendedAction: 'Welcome + onboard them' }
      : null,
  (c) =>
    c.daysSinceJoined != null && c.daysSinceJoined <= 14
      ? { category: 'COMMUNITY', score: 54, reason: 'Joined in the last 2 weeks', recommendedAction: 'Welcome them personally' }
      : null,
  (c) =>
    c.tags.has('Event Ticket')
      ? { category: 'COMMUNITY', score: 50, reason: 'Has an event ticket', recommendedAction: 'Prep / welcome them for the event' }
      : null,
];

function evaluate(c: Ctx): Match | null {
  let best: Match | null = null;
  for (const rule of RULES) {
    const m = rule(c);
    if (m && (!best || m.score > best.score)) best = m;
  }
  return best;
}

/** Days until the next occurrence of a birthday (month/day), ignoring year. */
function daysUntilBirthday(birthday: Date | null, now: Date): number | null {
  if (!birthday) return null;
  const y = now.getUTCFullYear();
  let next = Date.UTC(y, birthday.getUTCMonth(), birthday.getUTCDate());
  const today = Date.UTC(y, now.getUTCMonth(), now.getUTCDate());
  if (next < today) next = Date.UTC(y + 1, birthday.getUTCMonth(), birthday.getUTCDate());
  return Math.round((next - today) / DAY_MS);
}

interface UserRow {
  id: number;
  from_id: string | null;
  offer_type: string | null;
  payment_status: string | null;
  status: string | null;
  status_override: string | null;
  is_premium: boolean | null;
  is_lifetime: boolean | null;
  amount_paid: string | number | null;
  tags: string[] | null;
  is_current_member: boolean | null;
  left_at: string | null;
  member_since: string | null;
  birthday: string | null;
  roadmap_stage: string | null;
  roadmap_due_date: string | null;
}

/**
 * Recalculate the top opportunity for members (all, or a scoped set). Call
 * this after imports and whenever member data changes (wins, calls,
 * follow-ups, roadmap edits).
 */
export async function recomputeOpportunities(userIds?: number[]): Promise<number> {
  if (userIds && userIds.length === 0) return 0;
  await ensureSchema();

  const now = new Date();
  const nowMs = now.getTime();

  const usersResult = await queryWithRetry<UserRow>(
    `SELECT u.id, u.from_id, u.offer_type, u.payment_status, u.status, u.status_override,
            u.is_premium, u.is_lifetime, u.amount_paid, u.tags, u.is_current_member, u.left_at,
            u.member_since, u.birthday,
            mr.stage AS roadmap_stage, mr.due_date AS roadmap_due_date
     FROM users u
     LEFT JOIN member_roadmap mr ON mr.user_id = u.id
     ${userIds ? 'WHERE u.id = ANY($1::int[])' : ''}`,
    userIds ? [userIds] : undefined
  );
  const users = usersResult.rows;
  if (users.length === 0) return 0;

  const ids = users.map((u) => u.id);
  const fromIds = Array.from(new Set(users.map((u) => u.from_id).filter((v): v is string => !!v)));

  const [activityResult, winResult, coachResult, followResult, testimonialResult, existingResult] = await Promise.all([
    fromIds.length
      ? queryWithRetry<{ from_id: string; cnt: number; last_date: string | null }>(
          `SELECT from_id, COUNT(*)::int AS cnt, MAX(date) AS last_date
           FROM messages WHERE type = 'message' AND from_id = ANY($1::text[]) GROUP BY from_id`,
          [fromIds]
        )
      : Promise.resolve({ rows: [] as { from_id: string; cnt: number; last_date: string | null }[] }),
    queryWithRetry<{ user_id: number; cnt: number; last_at: string | null; max_amount: string | number | null }>(
      `SELECT user_id, COUNT(*)::int AS cnt, MAX(occurred_at) AS last_at, MAX(amount) AS max_amount
       FROM wins WHERE user_id = ANY($1::int[]) GROUP BY user_id`,
      [ids]
    ),
    queryWithRetry<{ user_id: number; last_at: string | null }>(
      `SELECT user_id, MAX(created_at) AS last_at FROM coach_notes WHERE user_id = ANY($1::int[]) GROUP BY user_id`,
      [ids]
    ),
    queryWithRetry<{ user_id: number; due_date: string }>(
      `SELECT user_id, due_date FROM follow_ups WHERE status = 'OPEN' AND due_date IS NOT NULL AND user_id = ANY($1::int[])`,
      [ids]
    ),
    fromIds.length
      ? queryWithRetry<{ from_id: string; text: string; date: string }>(
          `SELECT from_id, text, date FROM messages
           WHERE type = 'message' AND from_id = ANY($1::text[])
             AND (${TESTIMONIAL_PATTERNS.map((_, i) => `text ILIKE $${i + 2}`).join(' OR ')})
           ORDER BY date DESC LIMIT 1000`,
          [fromIds, ...TESTIMONIAL_PATTERNS.map((p) => `%${p}%`)]
        )
      : Promise.resolve({ rows: [] as { from_id: string; text: string; date: string }[] }),
    queryWithRetry<{ user_id: number; category: string | null; reason: string | null; done_at: string | null }>(
      `SELECT user_id, category, reason, done_at FROM opportunity_scores WHERE user_id = ANY($1::int[])`,
      [ids]
    ),
  ]);

  const activityMap = new Map(
    activityResult.rows.map((r) => [r.from_id, { cnt: Number(r.cnt), last: r.last_date ? new Date(r.last_date) : null }])
  );
  const winMap = new Map(
    winResult.rows.map((r) => [
      r.user_id,
      { count: Number(r.cnt), last: r.last_at ? new Date(r.last_at) : null, max: r.max_amount != null ? Number(r.max_amount) : null },
    ])
  );
  const coachMap = new Map(coachResult.rows.map((r) => [r.user_id, r.last_at ? new Date(r.last_at) : null]));
  const overdue = new Set<number>();
  const dueSoon = new Set<number>();
  for (const f of followResult.rows) {
    const d = (new Date(f.due_date).getTime() - nowMs) / DAY_MS;
    if (d < 0) overdue.add(f.user_id);
    else if (d <= 7) dueSoon.add(f.user_id);
  }
  const snippetMap = new Map<string, string>();
  for (const row of testimonialResult.rows) {
    if (snippetMap.has(row.from_id)) continue;
    const clean = row.text.replace(/\s+/g, ' ').trim().slice(0, 140);
    if (clean) snippetMap.set(row.from_id, clean);
  }
  const existingMap = new Map(existingResult.rows.map((r) => [r.user_id, r]));

  const daysSince = (d: Date | null) => (d ? (nowMs - d.getTime()) / DAY_MS : null);

  const rowsToWrite: { userId: number; score: number; category: string | null; reason: string | null; recommendedAction: string | null; doneAt: string | null }[] = [];

  for (const u of users) {
    const tags = new Set<string>(Array.isArray(u.tags) ? u.tags : []);
    const activity = u.from_id ? activityMap.get(u.from_id) : undefined;
    const win = winMap.get(u.id);
    const joinedAt = u.member_since ? new Date(u.member_since) : null;

    const ctx: Ctx = {
      offerType: u.offer_type ?? 'UNKNOWN',
      paymentStatus: u.payment_status ?? 'UNKNOWN',
      status: u.status ?? 'COLD',
      premiumAccess: !!u.is_premium,
      lifetimeAccess: !!u.is_lifetime,
      amountPaid: u.amount_paid != null ? Number(u.amount_paid) : null,
      overallMessageCount: activity?.cnt ?? 0,
      isCurrentMember: !!u.is_current_member,
      membershipRemoved: !!u.left_at || u.status_override === 'REMOVED' || u.status === 'REMOVED',
      daysSinceActive: activity?.last ? (nowMs - activity.last.getTime()) / DAY_MS : Infinity,
      daysSinceJoined: joinedAt ? (nowMs - joinedAt.getTime()) / DAY_MS : null,
      birthdayInDays: daysUntilBirthday(u.birthday ? new Date(u.birthday) : null, now),
      tags,
      stage: u.roadmap_stage ?? null,
      roadmapOverdue: !!(u.roadmap_due_date && new Date(u.roadmap_due_date).getTime() < nowMs),
      winCount: win?.count ?? 0,
      daysSinceWin: daysSince(win?.last ?? null),
      maxWinAmount: win?.max ?? null,
      daysSinceCoach: daysSince(coachMap.get(u.id) ?? null),
      overdueFollowUp: overdue.has(u.id),
      followUpDueSoon: dueSoon.has(u.id),
      testimonialSnippet: u.from_id ? snippetMap.get(u.from_id) ?? null : null,
    };

    const match = evaluate(ctx);
    const category = match?.category ?? null;
    const reason = match?.reason ?? null;

    // Keep "done" only while it's the same opportunity; a changed opportunity resurfaces.
    const prev = existingMap.get(u.id);
    const sameOpportunity = !!prev && prev.category === category && prev.reason === reason;
    const doneAt = sameOpportunity ? prev!.done_at : null;

    rowsToWrite.push({
      userId: u.id,
      score: match?.score ?? 0,
      category,
      reason,
      recommendedAction: match?.recommendedAction ?? null,
      doneAt,
    });
  }

  // One bulk upsert instead of one query per member — thousands of sequential
  // round-trips over a pooled serverless connection took 3+ minutes in
  // practice; this does the whole batch in a single round-trip.
  const BATCH_SIZE = 500;
  for (let i = 0; i < rowsToWrite.length; i += BATCH_SIZE) {
    const batch = rowsToWrite.slice(i, i + BATCH_SIZE);
    await queryWithRetry(
      `INSERT INTO opportunity_scores (user_id, score, category, reason, recommended_action, done_at, last_calculated)
       SELECT b.user_id, b.score, b.category, b.reason, b.recommended_action, b.done_at, NOW()
       FROM unnest($1::int[], $2::int[], $3::text[], $4::text[], $5::text[], $6::timestamptz[])
         AS b(user_id, score, category, reason, recommended_action, done_at)
       ON CONFLICT (user_id) DO UPDATE SET
         score = EXCLUDED.score, category = EXCLUDED.category, reason = EXCLUDED.reason,
         recommended_action = EXCLUDED.recommended_action, done_at = EXCLUDED.done_at, last_calculated = NOW()`,
      [
        batch.map((r) => r.userId),
        batch.map((r) => r.score),
        batch.map((r) => r.category),
        batch.map((r) => r.reason),
        batch.map((r) => r.recommendedAction),
        batch.map((r) => r.doneAt),
      ]
    );
  }

  return users.length;
}
