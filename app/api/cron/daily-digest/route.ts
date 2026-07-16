import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { getOpportunityBoard } from '@/lib/data/opportunities';
import { sendTelegramMessage, isTelegramConfigured } from '@/lib/telegram/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TOP_N_PER_CATEGORY = 5;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDigest(board: Awaited<ReturnType<typeof getOpportunityBoard>>): string {
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const lines: string[] = [`<b>📊 Opportunities — ${date}</b>`, `${board.totalOpen} open total\n`];

  for (const cat of board.categories) {
    if (cat.cards.length === 0) continue;
    lines.push(`${cat.emoji} <b>${escapeHtml(cat.title)}</b> (${cat.cards.length})`);
    for (const card of cat.cards.slice(0, TOP_N_PER_CATEGORY)) {
      const name = escapeHtml(card.displayName || card.username || card.fromId || `Member ${card.userId}`);
      lines.push(`• ${name} — ${escapeHtml(card.reason ?? '')}`);
    }
    if (cat.cards.length > TOP_N_PER_CATEGORY) {
      lines.push(`  …and ${cat.cards.length - TOP_N_PER_CATEGORY} more`);
    }
    lines.push('');
  }

  return lines.join('\n').slice(0, 4000); // Telegram's message length cap is 4096
}

/** Scheduled: send today's top opportunities to the configured Telegram chat. */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isTelegramConfigured()) {
    return NextResponse.json({ error: 'Telegram bot not configured (TELEGRAM_BOT_TOKEN missing)' }, { status: 503 });
  }
  const chatId = process.env.TELEGRAM_DIGEST_CHAT_ID;
  if (!chatId) {
    return NextResponse.json({ error: 'TELEGRAM_DIGEST_CHAT_ID not configured' }, { status: 503 });
  }

  try {
    const board = await getOpportunityBoard({ currentOnly: true });
    if (board.totalOpen === 0) return NextResponse.json({ sent: false, reason: 'no open opportunities' });
    await sendTelegramMessage(chatId, formatDigest(board));
    return NextResponse.json({ sent: true, totalOpen: board.totalOpen });
  } catch (err) {
    log.error('cron-daily-digest', 'Failed to send daily digest', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to send digest' },
      { status: 500 }
    );
  }
}
