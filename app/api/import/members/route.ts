import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db/client';
import { log } from '@/lib/logger';
import { parseMembersCSV } from '@/lib/import/parseMembersCSV';
import { applyMembersSnapshot } from '@/lib/import/membersSnapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/import/members
 * Accepts multipart/form-data with field "file" (CSV).
 * 1. Resets is_current_member = FALSE for all users in the group (via messages).
 * 2. Upserts each CSV row, setting is_current_member = TRUE.
 * Returns: { added, updated, total, groupId, durationMs, errors? }
 */
export async function POST(request: NextRequest) {
  try {
    await ensureSchema();
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith('.csv')) {
      return NextResponse.json({ error: 'File must be a .csv' }, { status: 400 });
    }

    const text = await file.text();
    const { rows, groupId, errors: parseErrors } = parseMembersCSV(text);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'No valid rows found in CSV', parseErrors },
        { status: 400 }
      );
    }

    const result = await applyMembersSnapshot(rows, groupId, file.name);
    const errors = [...parseErrors, ...result.errors];

    return NextResponse.json({
      added: result.added,
      updated: result.updated,
      total: result.total,
      groupId: result.groupId,
      durationMs: result.durationMs,
      errors: errors.length > 0 ? errors.slice(0, 50) : undefined,
      errorCount: errors.length,
    });
  } catch (err) {
    log.error('members-import', 'Members import failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Import failed' },
      { status: 500 }
    );
  }
}
