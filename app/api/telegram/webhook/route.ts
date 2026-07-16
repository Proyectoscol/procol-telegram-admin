import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { ensureSchema } from '@/lib/db/client';
import { sendTelegramMessage, isTelegramConfigured, type TelegramUpdate } from '@/lib/telegram/client';
import { buildMemberIndex, matchIdentity, normalizeUsername, type Identity } from '@/lib/import/matching';
import { createCoachNote } from '@/lib/crm/records';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The "input bot": a team member DMs this bot `<name or @username> - <note>`
 * (or `:` as the separator) after a call/DM, and it gets logged as a coach
 * note + a member_events timeline entry against that member — "send it to
 * the input bot and the CRM will just know."
 *
 * Access is restricted to TELEGRAM_ADMIN_IDS (comma-separated Telegram user
 * IDs) — this bot writes to the CRM, so it isn't open to arbitrary senders.
 * Set TELEGRAM_WEBHOOK_SECRET and pass it to Telegram's setWebhook
 * `secret_token` param to verify requests actually come from Telegram.
 */

function isAuthorizedSender(request: NextRequest): boolean {
  const configured = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!configured) return true; // no secret configured yet — allow (document this in setup)
  return request.headers.get('x-telegram-bot-api-secret-token') === configured;
}

function isAdminSender(userId: number | undefined): boolean {
  const allowlist = (process.env.TELEGRAM_ADMIN_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowlist.length === 0) return false; // fail closed: no allowlist configured = no one is authorized
  return userId != null && allowlist.includes(String(userId));
}

function parseInput(text: string): { identifier: string; note: string } | null {
  const match = text.match(/^(.+?)\s*[-:]\s*([\s\S]+)$/);
  if (!match) return null;
  const [, identifier, note] = match;
  if (!identifier.trim() || !note.trim()) return null;
  return { identifier: identifier.trim(), note: note.trim() };
}

export async function POST(request: NextRequest) {
  if (!isTelegramConfigured()) {
    return NextResponse.json({ error: 'Telegram bot not configured' }, { status: 503 });
  }
  if (!isAuthorizedSender(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const update = (await request.json()) as TelegramUpdate;
    const message = update.message;
    if (!message?.text) return NextResponse.json({ ok: true }); // ignore non-text updates

    const chatId = message.chat.id;
    const senderId = message.from?.id;
    const senderName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || message.from?.username || 'Unknown';

    if (!isAdminSender(senderId)) {
      await sendTelegramMessage(chatId, "Sorry, you're not authorized to log notes with this bot.");
      return NextResponse.json({ ok: true });
    }

    const parsed = parseInput(message.text);
    if (!parsed) {
      await sendTelegramMessage(
        chatId,
        'Send it as: <b>Name or @username - what happened</b>\n\ne.g. "Kevin Grant - called him, he wants the Lifetime upgrade next week"'
      );
      return NextResponse.json({ ok: true });
    }

    await ensureSchema();
    const identity: Identity = normalizeUsername(parsed.identifier)
      ? { name: null, username: parsed.identifier.replace(/^@/, ''), telegramId: null, email: null }
      : { name: parsed.identifier, username: null, telegramId: null, email: null };

    const idx = await buildMemberIndex();
    const result = matchIdentity(identity, idx);

    if (!result.user) {
      const hint = result.reason === 'DUPLICATE_NAME'
        ? `Found ${result.candidates?.length ?? 0} members with that name — use their @username instead.`
        : "Couldn't find a member with that name/username. Check the spelling and try again.";
      await sendTelegramMessage(chatId, hint);
      return NextResponse.json({ ok: true });
    }

    await createCoachNote(result.user.id, {
      note_type: 'TELEGRAM_BOT_INPUT',
      summary: parsed.note,
      created_by: senderName,
    });

    await sendTelegramMessage(chatId, `✅ Logged for ${result.user.display_name ?? identity.name ?? identity.username}: ${parsed.note}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error('telegram-webhook', 'Failed to process update', err);
    // Always 200 back to Telegram — a non-2xx makes it retry the same update repeatedly.
    return NextResponse.json({ ok: false });
  }
}
