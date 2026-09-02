import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { ensureSchema } from '@/lib/db/client';
import { applyCustomPlanIntakeTextBatch } from '@/lib/import/customPlanIntake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/import/custom-plan-intake/text — JSON { text }, AI-parsed apply. */
export async function POST(request: NextRequest) {
  try {
    await ensureSchema();
    const body = await request.json();
    const text = typeof body?.text === 'string' ? body.text : '';
    if (!text.trim()) return NextResponse.json({ error: 'No text provided' }, { status: 400 });
    const summary = await applyCustomPlanIntakeTextBatch([text]);
    return NextResponse.json(summary);
  } catch (err) {
    log.error('import-custom-plan-intake-text', 'POST /api/import/custom-plan-intake/text failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to apply Custom Plan Intake text import' },
      { status: 500 }
    );
  }
}
