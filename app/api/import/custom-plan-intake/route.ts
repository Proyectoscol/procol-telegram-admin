import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { ensureSchema } from '@/lib/db/client';
import { applyCustomPlanIntakeBatch } from '@/lib/import/customPlanIntake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/import/custom-plan-intake — multipart, one or more HTML files, apply. */
export async function POST(request: NextRequest) {
  try {
    await ensureSchema();
    const formData = await request.formData();
    const fileEntries = formData.getAll('files').filter((f): f is File => f instanceof File);
    if (fileEntries.length === 0) return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    const files = await Promise.all(fileEntries.map(async (f) => ({ name: f.name, buffer: Buffer.from(await f.arrayBuffer()) })));
    const summary = await applyCustomPlanIntakeBatch(files);
    return NextResponse.json(summary);
  } catch (err) {
    log.error('import-custom-plan-intake', 'POST /api/import/custom-plan-intake failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to apply Custom Plan Intake import' },
      { status: 500 }
    );
  }
}
