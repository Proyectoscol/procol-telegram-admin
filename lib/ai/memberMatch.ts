/**
 * AI-assisted member matching: a suggestion layer on top of the deterministic
 * matcher in lib/import/matching.ts. Deterministic matching only catches
 * exact email or exact-unique-name matches — real-world exports have people
 * whose Teachable name doesn't match their Telegram display name/username at
 * all (nicknames, initials, name order). Sending the whole roster to the
 * model and asking it to rank plausible candidates catches those cases.
 *
 * This never auto-applies a match — it only attaches ranked suggestions to
 * the review-queue row an admin still has to click to resolve. If the OpenAI
 * key isn't configured, or the call fails for any reason, this fails open
 * (returns no suggestions) rather than blocking the import — AI suggestions
 * are a convenience on top of the review queue, not a dependency of it.
 */
import { getOpenAiApiKey, getPersonaOpenAIModel } from '@/lib/settings';
import type { UserLite } from '@/lib/import/matching';

export interface MatchCandidateInput {
  /** Caller-defined key used to correlate a result back to the input row (e.g. email). */
  key: string;
  name: string | null;
  email: string | null;
}

export interface MatchSuggestion {
  userId: number;
  displayName: string | null;
  username: string | null;
  confidence: number;
  reason: string;
}

const SYSTEM_PROMPT = `You match people from an external export (e.g. a course platform) to existing members of a Telegram community CRM, when their name doesn't match a member exactly. You will be given a roster of existing members and a list of people to match.

For each person, return up to 3 plausible candidate member IDs from the roster — someone whose name is a variant, nickname, initials, different order, or otherwise plausibly the same person. Only suggest a candidate when there's a real textual reason to think it might be them. If nothing plausible exists, return an empty candidates array for that person. Never invent a member ID that isn't in the roster. Give each candidate a 0-100 confidence and a one-sentence reason.`;

interface AiResponseCandidate {
  user_id: number;
  confidence: number;
  reason: string;
}

interface AiResponseItem {
  index: number;
  candidates: AiResponseCandidate[];
}

const RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'member_match_suggestions',
    strict: true,
    schema: {
      type: 'object' as const,
      properties: {
        results: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              index: { type: 'integer' as const },
              candidates: {
                type: 'array' as const,
                items: {
                  type: 'object' as const,
                  properties: {
                    user_id: { type: 'integer' as const },
                    confidence: { type: 'integer' as const },
                    reason: { type: 'string' as const },
                  },
                  required: ['user_id', 'confidence', 'reason'],
                  additionalProperties: false,
                },
              },
            },
            required: ['index', 'candidates'],
            additionalProperties: false,
          },
        },
      },
      required: ['results'],
      additionalProperties: false,
    },
  },
};

/**
 * Batches every unmatched person from one import into a single OpenAI call
 * against the full member roster. Returns a map keyed by the input's `key`.
 * People with no plausible candidate, and people whose call fails entirely,
 * are simply absent from the returned map.
 */
export async function suggestMemberMatches(
  people: MatchCandidateInput[],
  roster: UserLite[]
): Promise<Map<string, MatchSuggestion[]>> {
  const out = new Map<string, MatchSuggestion[]>();
  if (people.length === 0 || roster.length === 0) return out;

  const apiKey = await getOpenAiApiKey();
  if (!apiKey) return out;

  let model: string;
  try {
    model = (await getPersonaOpenAIModel())?.trim() || 'gpt-4o-mini-2024-07-18';
  } catch {
    model = 'gpt-4o-mini-2024-07-18';
  }

  const rosterBlob = roster.map((u) => `${u.id}\t${u.display_name ?? ''}\t${u.username ?? ''}\t${u.email ?? ''}`).join('\n');
  const peopleBlob = people.map((p, i) => `${i}\t${p.name ?? ''}\t${p.email ?? ''}`).join('\n');
  const userPrompt = `## Existing CRM members (id, display name, username, email)
${rosterBlob}

## People to match (index, name, email)
${peopleBlob}

For each person by index, return ranked candidate member IDs per the rules in the system prompt.`;

  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system' as const, content: SYSTEM_PROMPT },
          { role: 'user' as const, content: userPrompt },
        ],
        response_format: RESPONSE_FORMAT,
      }),
    });
  } catch {
    return out; // network error — fail open, review queue still works manually
  }

  if (!res.ok) return out;

  let content: string | undefined;
  try {
    const data = await res.json();
    content = data.choices?.[0]?.message?.content;
  } catch {
    return out;
  }
  if (!content) return out;

  let parsed: { results: AiResponseItem[] };
  try {
    parsed = JSON.parse(content);
  } catch {
    return out;
  }

  const rosterById = new Map(roster.map((u) => [u.id, u]));
  for (const item of parsed.results ?? []) {
    const person = people[item.index];
    if (!person) continue;
    const suggestions: MatchSuggestion[] = [];
    for (const c of item.candidates ?? []) {
      const u = rosterById.get(c.user_id);
      if (!u) continue; // guard against a hallucinated ID
      suggestions.push({
        userId: u.id,
        displayName: u.display_name,
        username: u.username,
        confidence: Math.max(0, Math.min(100, Math.round(c.confidence))),
        reason: c.reason,
      });
    }
    if (suggestions.length > 0) {
      out.set(person.key, suggestions.sort((a, b) => b.confidence - a.confidence).slice(0, 3));
    }
  }
  return out;
}
