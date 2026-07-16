import { queryWithRetry, ensureSchema } from '@/lib/db/client';
import { OPP_CATEGORIES, OPP_META, type OppCategory } from '@/lib/opportunities/engine';

export interface OpportunityCard {
  userId: number;
  fromId: string | null;
  displayName: string | null;
  username: string | null;
  /** True for Premium OR Lifetime — Lifetime is a superset of Premium access. */
  isPremium: boolean;
  isLifetime: boolean;
  isCurrentMember: boolean;
  score: number;
  reason: string | null;
  recommendedAction: string | null;
  doneAt: string | null;
  lastCalculated: string;
}

export interface OpportunityCategoryBlock {
  category: OppCategory;
  emoji: string;
  title: string;
  blurb: string;
  cards: OpportunityCard[];
}

export interface OpportunityBoard {
  categories: OpportunityCategoryBlock[];
  totalOpen: number;
  lastCalculated: string | null;
}

interface OpportunityRow {
  user_id: number;
  score: number;
  category: OppCategory;
  reason: string | null;
  recommended_action: string | null;
  done_at: string | null;
  last_calculated: string;
  from_id: string | null;
  display_name: string | null;
  username: string | null;
  is_premium_effective: boolean | null;
  is_lifetime: boolean | null;
  is_current_member: boolean | null;
}

// Lifetime is a superset of Premium (Lifetime members have Premium access too).
// Computed from offer_type/tags too, not just the is_premium column, so this
// stays correct even for members imported before is_premium was backfilled.
const PREMIUM_EXPR = `(u.is_premium = TRUE OR u.offer_type = 'LIFETIME' OR u.tags ? 'Lifetime')`;
const LIFETIME_EXPR = `(u.offer_type = 'LIFETIME' OR u.tags ? 'Lifetime')`;

export type PremiumFilter = 'all' | 'only' | 'exclude';

export interface OpportunityBoardFilters {
  includeDone?: boolean;
  /** Only members currently in the community. Defaults to true. */
  currentOnly?: boolean;
  /** 'all' (default) | 'only' (Premium/Lifetime only) | 'exclude' (non-Premium only). */
  premiumFilter?: PremiumFilter;
}

/** The Opportunity Engine board: every open (not-done) opportunity, grouped by category. */
export async function getOpportunityBoard(filters: OpportunityBoardFilters = {}): Promise<OpportunityBoard> {
  const { includeDone = false, currentOnly = true, premiumFilter = 'all' } = filters;
  await ensureSchema();

  const conditions = ['o.category IS NOT NULL'];
  if (!includeDone) conditions.push('o.done_at IS NULL');
  if (currentOnly) conditions.push('u.is_current_member = TRUE');
  if (premiumFilter === 'only') conditions.push(PREMIUM_EXPR);
  if (premiumFilter === 'exclude') conditions.push(`NOT ${PREMIUM_EXPR}`);

  const result = await queryWithRetry<OpportunityRow>(
    `SELECT o.user_id, o.score, o.category, o.reason, o.recommended_action, o.done_at, o.last_calculated,
            u.from_id, u.display_name, u.username, u.is_current_member,
            ${PREMIUM_EXPR} AS is_premium_effective, ${LIFETIME_EXPR} AS is_lifetime
     FROM opportunity_scores o
     JOIN users u ON u.id = o.user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY o.category, o.score DESC`
  );

  const byCategory = new Map<OppCategory, OpportunityCard[]>();
  let lastCalculated: string | null = null;
  for (const row of result.rows) {
    const cards = byCategory.get(row.category) ?? [];
    cards.push({
      userId: row.user_id,
      fromId: row.from_id,
      displayName: row.display_name,
      username: row.username,
      isPremium: !!row.is_premium_effective,
      isLifetime: !!row.is_lifetime,
      isCurrentMember: !!row.is_current_member,
      score: row.score,
      reason: row.reason,
      recommendedAction: row.recommended_action,
      doneAt: row.done_at,
      lastCalculated: row.last_calculated,
    });
    byCategory.set(row.category, cards);
    if (!lastCalculated || new Date(row.last_calculated) > new Date(lastCalculated)) lastCalculated = row.last_calculated;
  }

  const categories: OpportunityCategoryBlock[] = OPP_CATEGORIES.map((category) => ({
    category,
    ...OPP_META[category],
    cards: byCategory.get(category) ?? [],
  }));

  const totalOpen = categories.reduce((sum, c) => sum + c.cards.length, 0);

  return { categories, totalOpen, lastCalculated };
}
