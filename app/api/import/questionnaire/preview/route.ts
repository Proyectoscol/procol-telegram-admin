import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { ensureSchema } from '@/lib/db/client';
import { previewQuestionnaire } from '@/lib/import/questionnaireImport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/import/questionnaire/preview — multipart file (CSV), dry run. */
export async function POST(request: NextRequest) {
  try {
    await ensureSchema();
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    const text = await file.text();
    const preview = await previewQuestionnaire(text);
    return NextResponse.json(preview);
  } catch (err) {
    log.error('import-questionnaire-preview', 'POST /api/import/questionnaire/preview failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to preview questionnaire import' },
      { status: 500 }
    );
  }
}
