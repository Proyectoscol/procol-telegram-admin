export interface TelegramExportMessage {
  id: number;
  type?: string;
  date?: string;
  date_unixtime?: string;
  edited?: string;
  edited_unixtime?: string;
  from?: string;
  from_id?: string;
  actor?: string;
  actor_id?: string;
  text?: string | { text?: string }[];
  text_entities?: { type?: string; text?: string }[];
  reply_to_message_id?: number;
  photo?: string;
  media_type?: string;
  file?: string;
  reactions?: {
    type?: string;
    emoji?: string;
    count?: number;
    recent?: { from?: string; from_id?: string; date?: string }[];
  }[];
  /**
   * True per-emoji reaction totals from Telegram (msg.reactions.results). Only ever populated
   * by the live MTProto scraper (lib/telegram-scraper/chatSync.ts) — manual Telegram Desktop
   * JSON exports never include real totals, only the capped `reactions[].recent` sample above.
   */
  reaction_totals?: { emoji: string; count: number }[];
}

export interface TelegramExport {
  id: number;
  name?: string;
  type?: string;
  messages?: TelegramExportMessage[];
}

function extractText(msg: TelegramExportMessage): string {
  const text = msg.text;
  if (typeof text === 'string') return text;
  if (Array.isArray(msg.text_entities)) {
    return msg.text_entities.map((e) => (e && typeof e.text === 'string' ? e.text : '')).join('');
  }
  if (Array.isArray(text)) {
    return text.map((t) => (t && typeof t === 'object' && 'text' in t ? (t as { text: string }).text : String(t))).join('');
  }
  return text != null ? String(text) : '';
}

export function getMessageText(msg: TelegramExportMessage): string {
  return extractText(msg);
}

export function getMediaType(msg: TelegramExportMessage): string | null {
  if (msg.photo !== undefined) return 'photo';
  if (msg.media_type) return msg.media_type;
  if (msg.file !== undefined) return 'file';
  return null;
}

export function parseEditedAt(msg: TelegramExportMessage): string | null {
  return msg.edited || null;
}
