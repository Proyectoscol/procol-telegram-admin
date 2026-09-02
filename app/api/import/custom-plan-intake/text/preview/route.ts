import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { ensureSchema } from '@/lib/db/client';
import { previewCustomPlanIntakeTextBatch } from '@/lib/import/customPlanIntake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/import/custom-plan-intake/text/preview — JSON { text }, AI-parsed dry run. */
export async function POST(request: NextRequest) {
  try {
    await ensureSchema();
    const body = await request.json();
    const text = typeof body?.text === 'string' ? body.text : '';
    if (!text.trim()) return NextResponse.json({ error: 'No text provided' }, { status: 400 });
    const preview = await previewCustomPlanIntakeTextBatch([text]);
    return NextResponse.json(preview);
  } catch (err) {
    log.error('import-custom-plan-intake-text-preview', 'POST /api/import/custom-plan-intake/text/preview failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to preview Custom Plan Intake text import' },
      { status: 500 }
    );
  }
}
