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
      const fileRes = await fetch(blobUrl);
      if (!fileRes.ok) {
        return NextResponse.json({ error: 'Failed to fetch uploaded file' }, { status: 400 });
      }
      text = await fileRes.text();
      fileName = blobUrl.split('/').pop() ?? 'result.json';

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
