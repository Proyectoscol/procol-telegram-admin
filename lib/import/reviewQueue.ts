/**
 * Resolves a pending import_reviews row to a chosen member. Dispatches to the
 * right importer's apply function based on import_type, since a review row
 * from a list import (tags/offer/payment) and one from the questionnaire
 * import (structured Q&A) need different handling.
 */
import { pool } from '@/lib/db/client';
import { recomputeOpportunities } from '@/lib/opportunities/engine';
import { applyTypeRules, getImportType, type MemberRow } from '@/lib/import/listImport';
import { applyQuestionnaireRow, type QuestionnaireRow } from '@/lib/import/questionnaireImport';

interface ImportReviewRow {
  id: number;
  import_type: string;
  raw_row: MemberRow | QuestionnaireRow;
  status: string;
}

/** Apply a pending review row's data to a chosen existing member, then mark it resolved. */
export async function resolveReviewRow(reviewId: number, userId: number): Promise<void> {
  const { rows } = await pool.query<ImportReviewRow>(
    `SELECT id, import_type, raw_row, status FROM import_reviews WHERE id = $1`,
    [reviewId]
  );
  const review = rows[0];
  if (!review) throw new Error('Review row not found');
  if (review.status !== 'PENDING') throw new Error(`Review row is already ${review.status.toLowerCase()}`);

  if (review.import_type === 'QUESTIONNAIRE') {
    await applyQuestionnaireRow(userId, review.raw_row as QuestionnaireRow);
  } else if (getImportType(review.import_type)) {
    await applyTypeRules(userId, review.import_type, review.raw_row as MemberRow);
  } else {
    throw new Error(`Unknown import type on review row: ${review.import_type}`);
  }

  await pool.query(`UPDATE import_reviews SET status = 'RESOLVED', resolved_user_id = $2 WHERE id = $1`, [reviewId, userId]);
  await recomputeOpportunities([userId]);
}

/** Mark a pending review row as skipped (no member update). */
export async function skipReviewRow(reviewId: number): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE import_reviews SET status = 'SKIPPED' WHERE id = $1 AND status = 'PENDING'`,
    [reviewId]
  );
  if (!rowCount) throw new Error('Review row not found or already resolved');
}
