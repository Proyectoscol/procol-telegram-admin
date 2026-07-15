import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { ensureSchema } from '@/lib/db/client';
import { applyQuestionnaire } from '@/lib/import/questionnaireImport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/import/questionnaire — multipart file (CSV), apply. */
export async function POST(request: NextRequest) {
  try {
    await ensureSchema();
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    const text = await file.text();
    const summary = await applyQuestionnaire(text, file.name);
    return NextResponse.json(summary);
  } catch (err) {
    log.error('import-questionnaire', 'POST /api/import/questionnaire failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to apply questionnaire import' },
      { status: 500 }
    );
  }
}
