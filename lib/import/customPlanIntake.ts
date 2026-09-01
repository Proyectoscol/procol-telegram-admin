/**
 * Custom Plan Intake Form import: applies parsed HTML exports (see
 * lib/import/customPlanIntakeHtml.ts) to matched members. Unlike the other
 * importers, matching here is fuzzy-username-first (this form's username
 * field is hand-typed into a Google Form, so typos/case/@ differences are
 * common) with an email fallback — see matchIdentityFuzzy in
 * lib/import/matching.ts. Never auto-creates a member: no match at all, or
 * more than one confident fuzzy-username candidate, goes to the review
 * queue instead.
 *
 * One HTML export is one respondent, but the user uploads many at once (one
 * per Telegram contact) — applyCustomPlanIntakeBatch takes the whole batch,
 * logs a single import_batches row, and returns per-outcome counts.
 */
import { pool } from '@/lib/db/client';
import { logMemberEvent } from '@/lib/timeline';
import { recomputeOpportunities } from '@/lib/opportunities/engine';
import { buildMemberIndex, matchIdentityFuzzy, createReviewRow, type Identity, type ReviewReason, type UserLite } from '@/lib/import/matching';
import { parseCustomPlanIntakeHtml, type CustomPlanIntakeParsed } from '@/lib/import/customPlanIntakeHtml';

export interface CustomPlanIntakeFile {
  name: string;
  html: string;
}

// ── Applying ─────────────────────────────────────────────────────────────

/** Upsert a matched response onto a member, backfill their name if missing, and log the import. Used directly and by the review-queue dispatcher. */
export async function applyCustomPlanIntakePerson(userId: number, parsed: CustomPlanIntakeParsed): Promise<{ nameMismatch: string | null }> {
  const s = parsed.structured;
  await pool.query(
    `INSERT INTO custom_plan_intake_responses (
       user_id, primary_income_source, monthly_profit_usd, monthly_revenue_usd, profit_goal_6mo_usd,
       niche, biggest_problem, has_sales_funnel, ran_paid_ads, team_structure, seriousness_level,
       current_stage, skill_scores, raw_answers, submitted_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       primary_income_source = COALESCE(EXCLUDED.primary_income_source, custom_plan_intake_responses.primary_income_source),
       monthly_profit_usd = COALESCE(EXCLUDED.monthly_profit_usd, custom_plan_intake_responses.monthly_profit_usd),
       monthly_revenue_usd = COALESCE(EXCLUDED.monthly_revenue_usd, custom_plan_intake_responses.monthly_revenue_usd),
       profit_goal_6mo_usd = COALESCE(EXCLUDED.profit_goal_6mo_usd, custom_plan_intake_responses.profit_goal_6mo_usd),
       niche = COALESCE(EXCLUDED.niche, custom_plan_intake_responses.niche),
       biggest_problem = COALESCE(EXCLUDED.biggest_problem, custom_plan_intake_responses.biggest_problem),
       has_sales_funnel = COALESCE(EXCLUDED.has_sales_funnel, custom_plan_intake_responses.has_sales_funnel),
       ran_paid_ads = COALESCE(EXCLUDED.ran_paid_ads, custom_plan_intake_responses.ran_paid_ads),
       team_structure = COALESCE(EXCLUDED.team_structure, custom_plan_intake_responses.team_structure),
       seriousness_level = COALESCE(EXCLUDED.seriousness_level, custom_plan_intake_responses.seriousness_level),
       current_stage = COALESCE(EXCLUDED.current_stage, custom_plan_intake_responses.current_stage),
       skill_scores = custom_plan_intake_responses.skill_scores || EXCLUDED.skill_scores,
       raw_answers = custom_plan_intake_responses.raw_answers || EXCLUDED.raw_answers,
       submitted_at = NOW()`,
    [
      userId,
      s.primaryIncomeSource,
      s.monthlyProfitUsd,
      s.monthlyRevenueUsd,
      s.profitGoal6moUsd,
      s.niche,
      s.biggestProblem,
      s.hasSalesFunnel,
      s.ranPaidAds,
      s.teamStructure,
      s.seriousnessLevel,
      s.currentStage,
      JSON.stringify(s.skillScores),
      JSON.stringify(parsed.rawAnswers),
    ]
  );

  let nameMismatch: string | null = null;
  if (parsed.fullName) {
    const { rows } = await pool.query<{ display_name: string | null }>(`SELECT display_name FROM users WHERE id = $1`, [userId]);
    const current = rows[0]?.display_name?.trim();
    if (!current) {
      await pool.query(`UPDATE users SET display_name = $2, updated_at = NOW() WHERE id = $1`, [userId, parsed.fullName]);
    } else if (current.toLowerCase() !== parsed.fullName.trim().toLowerCase()) {
      nameMismatch = `User ${userId}: form full name "${parsed.fullName}" differs from existing "${current}" — not overwritten.`;
    }
  }

  await logMemberEvent(userId, 'IMPORT', 'Custom Plan Intake form imported', {
    description: parsed.warnings.length > 0 ? `Parser warnings: ${parsed.warnings.join('; ')}` : undefined,
    source: 'custom_plan_intake_import',
  });

  return { nameMismatch };
}

// ── Preview + apply (batch) ─────────────────────────────────────────────

export interface CustomPlanIntakePreviewRow {
  fileName: string;
  input: CustomPlanIntakeParsed;
  status: 'update' | 'review' | 'skip';
  matchedBy?: 'username' | 'email';
  matchedUserName?: string;
  reason?: ReviewReason;
  candidateCount?: number;
  parseWarnings: string[];
  parseError?: string;
}

export interface CustomPlanIntakePreviewResult {
  rows: CustomPlanIntakePreviewRow[];
  counts: { total: number; update: number; review: number; skip: number };
}

function safeParse(file: CustomPlanIntakeFile): { parsed: CustomPlanIntakeParsed | null; error?: string } {
  try {
    return { parsed: parseCustomPlanIntakeHtml(file.html) };
  } catch (e) {
    return { parsed: null, error: (e as Error).message };
  }
}

export async function previewCustomPlanIntakeBatch(files: CustomPlanIntakeFile[]): Promise<CustomPlanIntakePreviewResult> {
  const idx = await buildMemberIndex();
  const rows: CustomPlanIntakePreviewRow[] = [];

  for (const file of files) {
    const { parsed, error } = safeParse(file);
    if (!parsed) {
      rows.push({ fileName: file.name, input: emptyParsed(), status: 'skip', parseWarnings: [], parseError: error });
      continue;
    }
    if (!parsed.username && !parsed.email) {
      rows.push({ fileName: file.name, input: parsed, status: 'skip', parseWarnings: parsed.warnings });
      continue;
    }
    const m = matchIdentityFuzzy(parsed, idx);
    if (m.user) {
      rows.push({
        fileName: file.name,
        input: parsed,
        status: 'update',
        matchedBy: m.matchedBy as 'username' | 'email',
        matchedUserName: m.user.display_name ?? undefined,
        parseWarnings: parsed.warnings,
      });
    } else {
      rows.push({
        fileName: file.name,
        input: parsed,
        status: 'review',
        reason: m.reason,
        candidateCount: m.candidates?.length ?? 0,
        parseWarnings: parsed.warnings,
      });
    }
  }

  const counts = {
    total: rows.length,
    update: rows.filter((r) => r.status === 'update').length,
    review: rows.filter((r) => r.status === 'review').length,
    skip: rows.filter((r) => r.status === 'skip').length,
  };
  return { rows, counts };
}

function emptyParsed(): CustomPlanIntakeParsed {
  return {
    name: null,
    username: null,
    telegramId: null,
    email: null,
    fullName: null,
    country: null,
    qa: [],
    rawAnswers: {},
    warnings: [],
    structured: {
      primaryIncomeSource: null,
      monthlyProfitUsd: null,
      monthlyRevenueUsd: null,
      profitGoal6moUsd: null,
      niche: null,
      biggestProblem: null,
      hasSalesFunnel: null,
      ranPaidAds: null,
      teamStructure: null,
      seriousnessLevel: null,
      currentStage: null,
      skillScores: {
        content_creation: null,
        copywriting: null,
        sales: null,
        offer_creation: null,
        audience_growth: null,
        branding: null,
        marketing: null,
        systems_automation: null,
      },
    },
  };
}

export interface CustomPlanIntakeSummary {
  totalFiles: number;
  updated: number;
  unmatched: number;
  skipped: number;
  errors: string[];
  nameMismatches: string[];
  parseWarnings: string[];
  batchId: number;
}

export async function applyCustomPlanIntakeBatch(files: CustomPlanIntakeFile[]): Promise<CustomPlanIntakeSummary> {
  const idx = await buildMemberIndex();

  let updated = 0;
  let unmatched = 0;
  let skipped = 0;
  const errors: string[] = [];
  const nameMismatches: string[] = [];
  const parseWarnings: string[] = [];
  const touched = new Set<number>();

  const batchRes = await pool.query<{ id: number }>(
    `INSERT INTO import_batches (kind, filename, total_rows) VALUES ('CUSTOM_PLAN_INTAKE', $1, $2) RETURNING id`,
    [files.length === 1 ? files[0].name : `${files.length} files`, files.length]
  );
  const batchId = batchRes.rows[0].id;

  for (const file of files) {
    const { parsed, error } = safeParse(file);
    if (!parsed) {
      skipped++;
      errors.push(`${file.name}: failed to parse (${error})`);
      continue;
    }
    if (parsed.warnings.length) parseWarnings.push(...parsed.warnings.map((w) => `${file.name}: ${w}`));

    if (!parsed.username && !parsed.email) {
      skipped++;
      continue;
    }

    const m = matchIdentityFuzzy(parsed, idx);
    if (m.user) {
      try {
        const { nameMismatch } = await applyCustomPlanIntakePerson(m.user.id, parsed);
        if (nameMismatch) nameMismatches.push(nameMismatch);
        touched.add(m.user.id);
        updated++;
      } catch (e) {
        errors.push(`${file.name}: ${(e as Error).message}`);
      }
    } else {
      unmatched++;
      const identity: Identity = { name: parsed.fullName, username: parsed.username, telegramId: null, email: parsed.email };
      await createReviewRow(batchId, 'CUSTOM_PLAN_INTAKE', m.reason ?? 'UNMATCHED', parsed, identity, m.candidates as UserLite[] | undefined);
    }
  }

  await pool.query(
    `UPDATE import_batches SET members_updated = $2, unmatched = $3, skipped = $4, error_count = $5 WHERE id = $1`,
    [batchId, updated, unmatched, skipped, errors.length]
  );

  if (touched.size) await recomputeOpportunities(Array.from(touched));

  return { totalFiles: files.length, updated, unmatched, skipped, errors, nameMismatches, parseWarnings, batchId };
}
