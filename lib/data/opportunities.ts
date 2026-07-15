import { queryWithRetry, ensureSchema } from '@/lib/db/client';
import { OPP_CATEGORIES, OPP_META, type OppCategory } from '@/lib/opportunities/engine';

export interface OpportunityCard {
  userId: number;
  fromId: string | null;
  displayName: string | null;
  username: string | null;
  isPremium: boolean;
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
  is_premium: boolean | null;
  is_current_member: boolean | null;
}

/** The Opportunity Engine board: every open (not-done) opportunity, grouped by category. */
export async function getOpportunityBoard(includeDone = false): Promise<OpportunityBoard> {
  await ensureSchema();

  const result = await queryWithRetry<OpportunityRow>(
    `SELECT o.user_id, o.score, o.category, o.reason, o.recommended_action, o.done_at, o.last_calculated,
            u.from_id, u.display_name, u.username, u.is_premium, u.is_current_member
     FROM opportunity_scores o
     JOIN users u ON u.id = o.user_id
     WHERE o.category IS NOT NULL ${includeDone ? '' : 'AND o.done_at IS NULL'}
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
      isPremium: !!row.is_premium,
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
