import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { ensureSchema } from '@/lib/db/client';
import { previewCustomPlanIntakeBatch } from '@/lib/import/customPlanIntake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/import/custom-plan-intake/preview — multipart, one or more HTML files, dry run. */
export async function POST(request: NextRequest) {
  try {
    await ensureSchema();
    const formData = await request.formData();
    const fileEntries = formData.getAll('files').filter((f): f is File => f instanceof File);
    if (fileEntries.length === 0) return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    const files = await Promise.all(fileEntries.map(async (f) => ({ name: f.name, html: await f.text() })));
    const preview = await previewCustomPlanIntakeBatch(files);
    return NextResponse.json(preview);
  } catch (err) {
    log.error('import-custom-plan-intake-preview', 'POST /api/import/custom-plan-intake/preview failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to preview Custom Plan Intake import' },
      { status: 500 }
    );
  }
}
