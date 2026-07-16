/** Minimal Telegram Bot API client. Inert until TELEGRAM_BOT_TOKEN is set. */

export function isTelegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

export async function sendTelegramMessage(chatId: string | number, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not configured');
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram sendMessage failed: ${res.status} ${body}`);
  }
}

export interface TelegramUpdate {
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string; last_name?: string };
    chat: { id: number };
    text?: string;
    date: number;
  };
}
