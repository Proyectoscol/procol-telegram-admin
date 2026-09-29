/**
 * Message record shape needed for formatted Telegram-style text export.
 * Compatible with the Top Liked Messages export rows (rank, author, chat, date, text, reactions, quotes).
 */
export interface MessageForTextExport {
  rank?: number;
  author?: string | null;
  chat?: string | null;
  date?: string | null;
  text?: string | null;
  reaction_count?: number;
  quote_count?: number;
}

/**
 * Formats an array of messages as plain text for pasting into Telegram/a doc.
 * One block per message: rank, author, chat, date, reaction/quote counts, then the text.
 */
export function formatMessagesAsText(messages: MessageForTextExport[]): string {
  if (messages.length === 0) return '';

  const blocks: string[] = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const num = m.rank ?? i + 1;
    const author = (m.author ?? '').trim() || '—';
    const chat = (m.chat ?? '').trim() || '—';
    const date = m.date ? new Date(m.date).toLocaleString('en-US') : '—';
    const reactions = Number(m.reaction_count) || 0;
    const quotes = Number(m.quote_count) || 0;
    const text = (m.text ?? '').trim() || '(no text)';
    blocks.push(
      `#${num} — ${author} · ${chat} · ${date}\n${text}\n${reactions} reaction${reactions === 1 ? '' : 's'} · ${quotes} quote${quotes === 1 ? '' : 's'}`
    );
  }

  return blocks.join('\n---\n');
}
