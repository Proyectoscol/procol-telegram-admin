/**
 * Shared persona generation + DB save logic.
 * Used by individual persona routes and the batch runner.
 * Does NOT use runPersonaSerial — callers that need serialisation must wrap.
 */

import { pool } from '@/lib/db/client';
import { buildPersonaContext, BuildPersonaContextOptions } from '@/lib/ai/persona';
import { generatePersona } from '@/lib/ai/openai';
import { computeCost } from '@/lib/ai/model-pricing';
import { log } from '@/lib/logger';

export interface RunPersonaOptions extends BuildPersonaContextOptions {
  rangeLabel?: string;
}

export interface RunPersonaResult {
  persona: Record<string, unknown>;
  usage: { model: string; prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function generateAndSavePersona(
  userId: number,
  options?: RunPersonaOptions,
): Promise<RunPersonaResult> {
  const context = await buildPersonaContext(userId, {
    chatIds: options?.chatIds,
    start: options?.start,
    end: options?.end,
  });

  const result = await generatePersona(context);
  const p = result.data;
  const profile = p.inferred_profile ?? { age_range: null, occupation: null, goals: [] };
  const social = p.social_links ?? { instagram: null, twitter: null, linkedin: null, other: [] };

  await pool.query(
    `INSERT INTO contact_personas (
      user_id, summary, topics, inferred_age_range, inferred_occupation, inferred_goals,
      social_links, content_preferences, pain_points, inference_evidence,
      model_used, prompt_tokens, completion_tokens, run_at, generated_for_range,
      buying_intent_score, buying_signals, follow_up_priority, engagement_level,
      outreach_approach, objection_patterns, spending_capacity
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), $14,
      $15, $16, $17, $18, $19, $20, $21
    )
    ON CONFLICT (user_id) DO UPDATE SET
      summary = EXCLUDED.summary,
      topics = EXCLUDED.topics,
      inferred_age_range = EXCLUDED.inferred_age_range,
      inferred_occupation = EXCLUDED.inferred_occupation,
      inferred_goals = EXCLUDED.inferred_goals,
      social_links = EXCLUDED.social_links,
      content_preferences = EXCLUDED.content_preferences,
      pain_points = EXCLUDED.pain_points,
      inference_evidence = EXCLUDED.inference_evidence,
      model_used = EXCLUDED.model_used,
      prompt_tokens = EXCLUDED.prompt_tokens,
      completion_tokens = EXCLUDED.completion_tokens,
      run_at = EXCLUDED.run_at,
      generated_for_range = EXCLUDED.generated_for_range,
      buying_intent_score = EXCLUDED.buying_intent_score,
      buying_signals = EXCLUDED.buying_signals,
      follow_up_priority = EXCLUDED.follow_up_priority,
      engagement_level = EXCLUDED.engagement_level,
      outreach_approach = EXCLUDED.outreach_approach,
      objection_patterns = EXCLUDED.objection_patterns,
      spending_capacity = EXCLUDED.spending_capacity`,
    [
      userId,
      p.summary ?? '',
      JSON.stringify(p.topics ?? []),
      profile.age_range ?? null,
      profile.occupation ?? null,
      JSON.stringify(profile.goals ?? []),
      JSON.stringify(social),
      p.content_preferences ?? '',
      JSON.stringify(p.pain_points ?? []),
      p.inference_evidence ?? '',
      result.usage.model,
      result.usage.prompt_tokens,
      result.usage.completion_tokens,
      options?.rangeLabel ?? null,
      p.buying_intent_score ?? 0,
      JSON.stringify(p.buying_signals ?? []),
      p.follow_up_priority ?? 'nurture',
      p.engagement_level ?? 'passive',
      p.outreach_approach ?? '',
      JSON.stringify(p.objection_patterns ?? []),
      p.spending_capacity ?? 'unknown',
    ],
  );

  const costEstimate = computeCost(
    result.usage.model,
    result.usage.prompt_tokens,
    result.usage.completion_tokens,
  );
  await pool.query(
    `INSERT INTO ai_usage_logs
       (entity_type, entity_id, model, prompt_tokens, completion_tokens, total_tokens, cost_estimate)
     VALUES ('persona_run', $1, $2, $3, $4, $5, $6)`,
    [
      userId,
      result.usage.model,
      result.usage.prompt_tokens,
      result.usage.completion_tokens,
      result.usage.total_tokens,
      costEstimate ?? null,
    ],
  );
  log.aiUsage('persona_run', {
    prompt_tokens: result.usage.prompt_tokens,
    completion_tokens: result.usage.completion_tokens,
    model: result.usage.model,
    entity_type: 'persona_run',
    entity_id: userId,
  });

  const { rows } = await pool.query(
    `SELECT * FROM contact_personas WHERE user_id = $1`,
    [userId],
  );
  return { persona: rows[0] as Record<string, unknown>, usage: result.usage };
}
