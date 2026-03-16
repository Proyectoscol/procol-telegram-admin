/**
 * Member record shape needed for formatted Telegram text export.
 * Compatible with dashboard export rows (display_name, username, is_premium, messages_sent, reactions_given).
 */
export interface MemberForTextExport {
  username?: string | null;
  display_name?: string | null;
  is_premium?: boolean;
  messages_sent?: number;
  reactions_given?: number;
}

/**
 * Formats an array of members as plain text for pasting into Telegram.
 * - Sequential numbering from 1
 * - Every 6 entries, a blank line is inserted as a visual separator
 * - Premium: ✅ for true/Yes, ❌ for false/No
 * - No username → show "@" before the name
 * - Messages and Reactions always shown (0 if missing)
 */
export function formatMembersAsText(members: MemberForTextExport[]): string {
  if (members.length === 0) return '';

  const lines: string[] = [];
  const GROUP_SIZE = 6;

  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    const num = i + 1;
    const usernamePart = m.username?.trim() ? `@${m.username.trim()}` : '@';
    const fullName = (m.display_name ?? '').trim() || '—';
    const premium = resolvePremium(m.is_premium);
    const messages = Number(m.messages_sent) ?? 0;
    const reactions = Number(m.reactions_given) ?? 0;
    const line = `${num}. ${usernamePart} - ${fullName} | Premium: ${premium} | Messages: ${messages} Reactions: ${reactions}`;
    lines.push(line);

    if ((i + 1) % GROUP_SIZE === 0 && i + 1 < members.length) {
      lines.push('');
    }
  }

  return lines.join('\n');
}

function resolvePremium(value: boolean | string | unknown): '✅' | '❌' {
  if (value === true || value === 'Yes' || value === 'yes') return '✅';
  return '❌';
}
