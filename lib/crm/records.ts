/**
 * Shared create/list logic for the CRM sales/coaching layer (wins, coach
 * notes, follow-ups, roadmap, calls). Each mutation logs a member_events row
 * and — except calls, which the Opportunity Engine doesn't read — triggers a
 * recompute so the homepage reflects the change immediately.
 */
import { pool } from '@/lib/db/client';
import { logMemberEvent } from '@/lib/timeline';
import { recomputeOpportunities } from '@/lib/opportunities/engine';

// ── Wins ─────────────────────────────────────────────────────────────────

export interface WinInput {
  amount?: number | null;
  description?: string | null;
  occurred_at?: string | null;
  source?: string | null;
  confidence?: string | null;
}

export async function listWins(userId: number) {
  const { rows } = await pool.query(
    `SELECT id, amount, description, occurred_at, source, confidence, created_at
     FROM wins WHERE user_id = $1 ORDER BY occurred_at DESC NULLS LAST, created_at DESC`,
    [userId]
  );
  return rows;
}

export async function createWin(userId: number, input: WinInput) {
  const { rows } = await pool.query(
    `INSERT INTO wins (user_id, amount, description, occurred_at, source, confidence)
     VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()), $5, $6)
     RETURNING id, amount, description, occurred_at, source, confidence, created_at`,
    [userId, input.amount ?? null, input.description ?? null, input.occurred_at ?? null, input.source ?? null, input.confidence ?? null]
  );
  const win = rows[0];
  const amt = win.amount != null ? ` ($${Number(win.amount).toLocaleString()})` : '';
  await logMemberEvent(userId, 'WIN', `Win logged${amt}`, {
    description: win.description,
    occurredAt: win.occurred_at,
    source: 'manual',
  });
  await recomputeOpportunities([userId]);
  return win;
}

// ── Coach notes ──────────────────────────────────────────────────────────

export interface CoachNoteInput {
  note_type?: string | null;
  summary?: string | null;
  next_action?: string | null;
  follow_up_date?: string | null;
  created_by?: string | null;
}

export async function listCoachNotes(userId: number) {
  const { rows } = await pool.query(
    `SELECT id, note_type, summary, next_action, follow_up_date, created_by, created_at
     FROM coach_notes WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

export async function createCoachNote(userId: number, input: CoachNoteInput) {
  const { rows } = await pool.query(
    `INSERT INTO coach_notes (user_id, note_type, summary, next_action, follow_up_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, note_type, summary, next_action, follow_up_date, created_by, created_at`,
    [userId, input.note_type ?? null, input.summary ?? null, input.next_action ?? null, input.follow_up_date ?? null, input.created_by ?? null]
  );
  const note = rows[0];
  await logMemberEvent(userId, 'COACH_CALL', note.note_type ? `Coach note (${note.note_type})` : 'Coach note', {
    description: note.summary,
    source: note.created_by,
  });
  await recomputeOpportunities([userId]);
  return note;
}

// ── Follow-ups ───────────────────────────────────────────────────────────

export interface FollowUpInput {
  due_date?: string | null;
  priority?: string | null;
  reason?: string | null;
}

export async function listFollowUps(userId: number) {
  const { rows } = await pool.query(
    `SELECT id, due_date, status, priority, reason, completed_at, created_at
     FROM follow_ups WHERE user_id = $1 ORDER BY (status = 'OPEN') DESC, due_date ASC NULLS LAST, created_at DESC`,
    [userId]
  );
  return rows;
}

export async function createFollowUp(userId: number, input: FollowUpInput) {
  const { rows } = await pool.query(
    `INSERT INTO follow_ups (user_id, due_date, priority, reason)
     VALUES ($1, $2, $3, $4)
     RETURNING id, due_date, status, priority, reason, completed_at, created_at`,
    [userId, input.due_date ?? null, input.priority ?? 'MEDIUM', input.reason ?? null]
  );
  const followUp = rows[0];
  await logMemberEvent(userId, 'FOLLOW_UP', 'Follow-up scheduled', {
    description: followUp.reason,
    occurredAt: followUp.due_date,
  });
  await recomputeOpportunities([userId]);
  return followUp;
}

export async function setFollowUpStatus(userId: number, followUpId: number, status: 'DONE' | 'CANCELLED' | 'OPEN') {
  const { rows } = await pool.query(
    `UPDATE follow_ups SET status = $2, completed_at = CASE WHEN $2 = 'DONE' THEN NOW() ELSE NULL END, updated_at = NOW()
     WHERE id = $1 AND user_id = $3
     RETURNING id, due_date, status, priority, reason, completed_at, created_at`,
    [followUpId, status, userId]
  );
  if (rows[0] && status === 'DONE') {
    await logMemberEvent(userId, 'FOLLOW_UP', 'Follow-up completed', { description: rows[0].reason });
  }
  await recomputeOpportunities([userId]);
  return rows[0] ?? null;
}

// ── Roadmap (one row per member) ────────────────────────────────────────

export interface RoadmapInput {
  stage?: string | null;
  main_goal?: string | null;
  current_blocker?: string | null;
  next_action?: string | null;
  assigned_to?: string | null;
  due_date?: string | null;
  progress_notes?: string | null;
}

export async function getRoadmap(userId: number) {
  const { rows } = await pool.query(
    `SELECT stage, main_goal, current_blocker, next_action, assigned_to, due_date, progress_notes, created_at, updated_at
     FROM member_roadmap WHERE user_id = $1`,
    [userId]
  );
  return rows[0] ?? null;
}

export async function upsertRoadmap(userId: number, input: RoadmapInput) {
  const { rows } = await pool.query(
    `INSERT INTO member_roadmap (user_id, stage, main_goal, current_blocker, next_action, assigned_to, due_date, progress_notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id) DO UPDATE SET
       stage = EXCLUDED.stage, main_goal = EXCLUDED.main_goal, current_blocker = EXCLUDED.current_blocker,
       next_action = EXCLUDED.next_action, assigned_to = EXCLUDED.assigned_to, due_date = EXCLUDED.due_date,
       progress_notes = EXCLUDED.progress_notes, updated_at = NOW()
     RETURNING stage, main_goal, current_blocker, next_action, assigned_to, due_date, progress_notes, created_at, updated_at`,
    [
      userId,
      input.stage ?? null,
      input.main_goal ?? null,
      input.current_blocker ?? null,
      input.next_action ?? null,
      input.assigned_to ?? null,
      input.due_date ?? null,
      input.progress_notes ?? null,
    ]
  );
  const roadmap = rows[0];
  await logMemberEvent(userId, 'ROADMAP_CHANGE', roadmap.stage ? `Roadmap updated — ${roadmap.stage}` : 'Roadmap updated', {
    description: roadmap.next_action,
    occurredAt: roadmap.due_date,
  });
  await recomputeOpportunities([userId]);
  return roadmap;
}

// ── Calls (contact_calls — freeform sales/coaching call log) ────────────

export interface CallInput {
  called_at?: string | null;
  notes?: string | null;
  objections?: string | null;
  plans_discussed?: string | null;
  current_situation?: string | null;
  next_step?: string | null;
  offer_discussed?: string | null;
  likelihood?: number | null;
  follow_up_date?: string | null;
  created_by?: string | null;
}

export async function listContactCalls(userId: number) {
  const { rows } = await pool.query(
    `SELECT id, call_number, called_at, notes, objections, plans_discussed, current_situation,
            next_step, offer_discussed, likelihood, follow_up_date, created_by, created_at
     FROM contact_calls WHERE user_id = $1 ORDER BY called_at DESC NULLS LAST, created_at DESC`,
    [userId]
  );
  return rows;
}

export async function createContactCall(userId: number, input: CallInput) {
  const { rows } = await pool.query(
    `INSERT INTO contact_calls (
       user_id, called_at, notes, objections, plans_discussed, current_situation,
       next_step, offer_discussed, likelihood, follow_up_date, created_by
     )
     VALUES ($1, COALESCE($2::timestamptz, NOW()), $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, call_number, called_at, notes, objections, plans_discussed, current_situation,
               next_step, offer_discussed, likelihood, follow_up_date, created_by, created_at`,
    [
      userId,
      input.called_at ?? null,
      input.notes ?? null,
      input.objections ?? null,
      input.plans_discussed ?? null,
      input.current_situation ?? null,
      input.next_step ?? null,
      input.offer_discussed ?? null,
      input.likelihood ?? null,
      input.follow_up_date ?? null,
      input.created_by ?? null,
    ]
  );
  const call = rows[0];
  await logMemberEvent(userId, 'SALES_CALL', 'Call logged', {
    description: call.notes,
    occurredAt: call.called_at,
    source: call.created_by,
  });
  return call;
}
