import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { ensureSchema } from '@/lib/db/client';
import { applyQuestionnaireTextBatch } from '@/lib/import/questionnaireImport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/import/questionnaire/text — JSON { text }, AI-parsed apply. */
export async function POST(request: NextRequest) {
  try {
    await ensureSchema();
    const body = await request.json();
    const text = typeof body?.text === 'string' ? body.text : '';
    if (!text.trim()) return NextResponse.json({ error: 'No text provided' }, { status: 400 });
    const summary = await applyQuestionnaireTextBatch([text]);
    return NextResponse.json(summary);
  } catch (err) {
    log.error('import-questionnaire-text', 'POST /api/import/questionnaire/text failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to apply Welcome questionnaire text import' },
      { status: 500 }
    );
  }
}
