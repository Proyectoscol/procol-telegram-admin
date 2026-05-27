import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db/client';
import { ingestExport } from '@/lib/ingest/ingest';
import type { TelegramExport } from '@/lib/ingest/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    await ensureSchema();

    let text: string;
    let fileName: string;

    const contentType = request.headers.get('content-type') ?? '';

    if (contentType.includes('application/json')) {
      const { blobUrl } = (await request.json()) as { blobUrl?: string };
      if (!blobUrl) {
        return NextResponse.json({ error: 'No blobUrl provided' }, { status: 400 });
      }
      // Retry up to 3 times — blob may not be immediately accessible after upload
      let fileRes: Response | null = null;
      let fetchErr: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 1500));
        try {
          fileRes = await fetch(blobUrl);
          if (fileRes.ok) break;
        } catch (err) {
          fetchErr = err;
          fileRes = null;
        }
      }
      if (!fileRes?.ok) {
        const detail = fileRes
          ? `HTTP ${fileRes.status}: ${(await fileRes.text().catch(() => '')).slice(0, 200)}`
          : (fetchErr instanceof Error ? fetchErr.message : String(fetchErr));
        return NextResponse.json({ error: `Failed to fetch uploaded file: ${detail}` }, { status: 400 });
      }
      text = await fileRes.text();
      fileName = blobUrl.split('/').pop()?.split('?')[0] ?? 'result.json';

      // Delete from blob storage after reading
      const { del } = await import('@vercel/blob');
      await del(blobUrl).catch(() => {});
    } else {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      if (!file) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 });
      }
      text = await file.text();
      fileName = file.name;
    }

    const data = JSON.parse(text) as TelegramExport;
    if (typeof data.id !== 'number' || !Array.isArray(data.messages)) {
      return NextResponse.json(
        { error: 'Invalid export: expected id and messages array' },
        { status: 400 }
      );
    }
    const result = await ingestExport(data, fileName);
    return NextResponse.json(result);
  } catch (err) {
    const { log } = await import('@/lib/logger');
    log.error('ingest', 'Ingest failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ingest failed' },
      { status: 500 }
    );
  }
}
