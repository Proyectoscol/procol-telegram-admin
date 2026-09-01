/**
 * Shared "NM Custom Plan Intake Form" logic: question grouping, keyword
 * matching, and structured-field assembly. Independent of where the leaves
 * (positioned text runs) and scale-question answers came from — the HTML
 * (pdf2htmlEX) parser and the direct-PDF parser both produce the same
 * LeafDiv[] shape and both call assembleCustomPlanIntake below.
 */
import type { Identity } from '@/lib/import/matching';

export interface LeafDiv {
  page: number;
  x: number;
  y: number;
  ff: string; // font family/style key (a CSS class token for HTML, a font name for PDF) — opaque, only compared for equality
  fs: string; // font size key — opaque, only compared for equality
  fc: string; // fill color key (a CSS class token for HTML, a color string for PDF) — opaque, only compared for equality
  text: string;
}

export interface ScaleHit {
  page: number;
  value: number; // 1-10
}

export interface Question {
  label: string;
  kind: 'choice' | 'freetext' | 'scale';
  freeTextLines: string[];
  options: { text: string; fc: string }[];
}

// The Google Forms required-field marker is usually a literal "*", but a
// subset font can render it (for at least one label, seen in a real sample)
// as a Private-Use-Area glyph instead — pdf2htmlEX maps characters missing
// from the subsetted font's normal Unicode range into U+E000-U+F8FF. Strip
// either form, plus any adjoining whitespace, from the end of label text.
export function stripRequiredMarker(text: string): string {
  let end = text.length;
  while (end > 0) {
    const ch = text.charCodeAt(end - 1);
    const isMarker = ch === 0x2a || (ch >= 0xe000 && ch <= 0xf8ff);
    const isSpace = /\s/.test(text[end - 1]);
    if (!isMarker && !isSpace) break;
    end--;
  }
  return text.slice(0, end).trim();
}

const SCALE_TICKS_RE = /^\d+(\s+\d+){2,}$/;
const SCALE_CAPTION_RE = /^(very\s+(low|high)|not\s+serious|fully\s+commi?tted?)/i;

// The 1-10 linear-scale questions (skill sliders + Seriousness Level) never
// have their answer represented as text at all — the filled dot is a
// separate graphical element (a rasterized pixel or a vector-filled circle,
// depending on parser). These labels are known and fixed for this specific
// form, so they're recognized by keyword up front, rather than inferred
// from trailing tick-mark text, which turned out to be unreliable: a
// converter can place several short adjacent question labels at the exact
// same position on a dense page, and the general position-sorted grouping
// below can't tell which of several tied labels a trailing line belongs to.
export const SCALE_LABEL_PATTERNS: Record<string, RegExp> = {
  contentCreation: /^content\s*creation\s*$/i,
  copywriting: /^copywriting\s*$/i,
  sales: /^sales\s*$/i,
  offerCreation: /^offer\s*creation\s*$/i,
  audienceGrowth: /^audience\s*growth\s*$/i,
  branding: /^branding\s*$/i,
  marketing: /^marketing\s*$/i,
  systemsAutomation: /systems\s*and\s*automation/i,
  seriousnessLevel: /seriousness\s*level/i,
};

function isScaleLabel(label: string): boolean {
  return Object.values(SCALE_LABEL_PATTERNS).some((re) => re.test(label));
}

export function groupQuestions(leaves: LeafDiv[]): { questions: Question[]; scaleQuestionRefs: { page: number; question: Question }[] } {
  const sorted = [...leaves].sort((a, b) => (a.page !== b.page ? a.page - b.page : b.y - a.y || a.x - b.x));

  // Label style = whichever (ff,fs) pair is used most often by divs whose
  // text ends in the Google Forms required-field marker "*" — derived from
  // the document itself rather than a hardcoded class name.
  const styleCounts = new Map<string, number>();
  for (const l of sorted) {
    if (/\*$/.test(l.text)) {
      const key = `${l.ff}|${l.fs}`;
      styleCounts.set(key, (styleCounts.get(key) ?? 0) + 1);
    }
  }
  let labelStyle = '';
  let labelStyleCount = 0;
  styleCounts.forEach((count, key) => {
    if (count > labelStyleCount) {
      labelStyle = key;
      labelStyleCount = count;
    }
  });
  const isLabel = (l: LeafDiv) => `${l.ff}|${l.fs}` === labelStyle && l.text.length > 0;

  // Free-text "content" color = whichever fc value has the most divs overall
  // (most of a filled-in response is free text) — used to filter out
  // decorative section headers, which use a different, exclusive fc.
  const fcCounts = new Map<string, number>();
  for (const l of sorted) fcCounts.set(l.fc, (fcCounts.get(l.fc) ?? 0) + 1);
  let contentFc = '';
  let contentFcCount = 0;
  fcCounts.forEach((count, fc) => {
    if (count > contentFcCount) {
      contentFc = fc;
      contentFcCount = count;
    }
  });

  const questions: Question[] = [];
  let current: Question | null = null;

  // Option runs: consecutive divs sharing the exact same page+x (real option
  // columns always reuse the identical position — a "close enough"
  // tolerance here previously mis-merged a free-text answer with an
  // unrelated section header that happened to sit at a nearby x), in a run
  // of >= 2, whose fc values are confined to exactly two distinct values,
  // are the "selected"/"unselected" pair for a choice question. Which of
  // the two means "selected" is resolved later, by frequency across the
  // whole document (the caller aggregates every question's options for that).
  for (let i = 0; i < sorted.length; i++) {
    const l = sorted[i];
    if (stripRequiredMarker(l.text).length === 0) continue;

    if (isLabel(l)) {
      const label = stripRequiredMarker(l.text);
      current = { label, kind: isScaleLabel(label) ? 'scale' : 'freetext', freeTextLines: [], options: [] };
      questions.push(current);
      continue;
    }
    if (!current) continue; // stray text before the first question (title, etc.)
    if (current.kind === 'scale') continue; // answer comes from a graphical element, not text
    if (SCALE_TICKS_RE.test(l.text) || SCALE_CAPTION_RE.test(l.text)) continue; // decorative scale-widget text

    // Is this div part of a same-page/same-x run of >= 2 with exactly 2 fc values?
    let j = i;
    while (j + 1 < sorted.length) {
      const nxt = sorted[j + 1];
      if (nxt.page !== l.page || isLabel(nxt) || nxt.x !== l.x) break;
      j++;
    }
    const run = sorted.slice(i, j + 1);
    const runFcs = new Set(run.map((d) => d.fc));
    if (j > i && runFcs.size === 2) {
      current.kind = 'choice';
      for (const d of run) current.options.push({ text: d.text, fc: d.fc });
      i = j;
      continue;
    }

    if (l.fc !== contentFc) continue; // section header or other decoration
    current.freeTextLines.push(l.text);
  }

  // Scale questions' answers come from a graphical element, not from text
  // that follows the label, so they're paired up separately using the RAW
  // (unsorted) document order rather than the position-sorted order above.
  // On a dense page with several short scale questions back to back, a
  // converter can assign more than one label the exact same position (a
  // shared baseline row), which makes the position sort's left-to-right,
  // top-to-bottom order ambiguous between them — but the underlying
  // document stream still emits labels in correct top-to-bottom reading order.
  const scaleQuestionRefs: { page: number; question: Question }[] = [];
  const pendingByLabel = new Map<string, Question[]>();
  for (const q of questions) {
    if (q.kind !== 'scale') continue;
    const arr = pendingByLabel.get(q.label) ?? [];
    arr.push(q);
    pendingByLabel.set(q.label, arr);
  }
  for (const l of leaves) {
    if (!isLabel(l)) continue;
    const label = stripRequiredMarker(l.text);
    const arr = pendingByLabel.get(label);
    if (arr && arr.length) scaleQuestionRefs.push({ page: l.page, question: arr.shift()! });
  }

  return { questions, scaleQuestionRefs };
}

// ── Field keyword matching (same style as questionnaireImport's header matching) ──

const IDENTITY_PATTERNS: Record<string, RegExp> = {
  email: /^e-?mail/i,
  username: /^telegram\s*username/i,
  fullName: /^full\s*name/i,
  country: /country/i,
};

const STRUCTURED_PATTERNS: Record<string, RegExp> = {
  primaryIncomeSource: /primary\s*income\s*source/i,
  monthlyProfitUsd: /profit.*per\s*month|monthly.*profit(?!.*next)/i,
  monthlyRevenueUsd: /revenue.*per\s*month|monthly.*revenue/i,
  profitGoal6moUsd: /profit.*next\s*6\s*months?|6\s*months?.*profit/i,
  niche: /niche or industry|what niche/i,
  biggestProblem: /biggest\s*problem/i,
  hasSalesFunnel: /sales\s*funnel\s*set\s*up/i,
  ranPaidAds: /paid\s*ads/i,
  teamStructure: /work\s*alone\s*or\s*with\s*a\s*team|do you work alone/i,
  currentStage: /stage\s*best\s*describes/i,
  ...SCALE_LABEL_PATTERNS,
};

function parseUsd(s: string | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}

function parseYesNo(s: string | undefined): boolean | null {
  if (!s) return null;
  if (/^yes/i.test(s.trim())) return true;
  if (/^no/i.test(s.trim())) return false;
  return null;
}

function teamStructureFromAnswer(s: string | undefined): string | null {
  if (!s) return null;
  if (/alone/i.test(s)) return 'ALONE';
  if (/contractor|freelanc/i.test(s)) return 'CONTRACTORS';
  if (/employee|team/i.test(s)) return 'EMPLOYEES';
  return null;
}

function currentStageFromAnswer(s: string | undefined): string | null {
  if (!s) return null;
  if (/no\s*audience/i.test(s)) return 'NO_AUDIENCE';
  if (/audience.*no\s*monetization/i.test(s)) return 'AUDIENCE_NO_MONETIZATION';
  if (/monetization.*low\s*scale/i.test(s)) return 'LOW_SCALE';
  if (/scaling\s*bottleneck/i.test(s)) return 'SCALING_BOTTLENECK';
  return null;
}

export interface SkillScores {
  content_creation: number | null;
  copywriting: number | null;
  sales: number | null;
  offer_creation: number | null;
  audience_growth: number | null;
  branding: number | null;
  marketing: number | null;
  systems_automation: number | null;
}

export interface CustomPlanIntakeStructured {
  primaryIncomeSource: string | null;
  monthlyProfitUsd: number | null;
  monthlyRevenueUsd: number | null;
  profitGoal6moUsd: number | null;
  niche: string | null;
  biggestProblem: string | null;
  hasSalesFunnel: boolean | null;
  ranPaidAds: boolean | null;
  teamStructure: string | null;
  seriousnessLevel: number | null;
  currentStage: string | null;
  skillScores: SkillScores;
}

export interface CustomPlanIntakeParsed extends Identity {
  fullName: string | null;
  country: string | null;
  qa: { question: string; answer: string | string[] }[];
  rawAnswers: Record<string, string>;
  structured: CustomPlanIntakeStructured;
  warnings: string[];
}

function emptyStructured(): CustomPlanIntakeStructured {
  return {
    primaryIncomeSource: null,
    monthlyProfitUsd: null,
    monthlyRevenueUsd: null,
    profitGoal6moUsd: null,
    niche: null,
    biggestProblem: null,
    hasSalesFunnel: null,
    ranPaidAds: null,
    teamStructure: null,
    seriousnessLevel: null,
    currentStage: null,
    skillScores: {
      content_creation: null,
      copywriting: null,
      sales: null,
      offer_creation: null,
      audience_growth: null,
      branding: null,
      marketing: null,
      systems_automation: null,
    },
  };
}

/**
 * Groups leaves into questions, resolves choice/scale answers, and matches
 * known keywords into the promoted identity/structured fields. `resolveScaleHits`
 * is called once per page that has >= 1 scale-type question, and must return
 * that page's filled-dot hits ordered top-to-bottom (throwing or returning an
 * empty array is treated as "couldn't resolve this page").
 */
export function assembleCustomPlanIntake(
  leaves: LeafDiv[],
  resolveScaleHits: (page: number) => ScaleHit[],
  initialWarnings: string[] = []
): CustomPlanIntakeParsed {
  const warnings = [...initialWarnings];
  const { questions, scaleQuestionRefs } = groupQuestions(leaves);

  // Resolve the selected option's fc value by frequency across the whole
  // document (the minority of the two colors is "selected" — most
  // questions have far more unselected options than selected ones).
  const optionFcCounts = new Map<string, number>();
  for (const q of questions) for (const o of q.options) optionFcCounts.set(o.fc, (optionFcCounts.get(o.fc) ?? 0) + 1);
  let selectedFc: string | null = null;
  if (optionFcCounts.size === 2) {
    selectedFc = Array.from(optionFcCounts.entries()).sort((a, b) => a[1] - b[1])[0][0];
  } else if (optionFcCounts.size > 0) {
    warnings.push(
      `Expected exactly 2 distinct option colors (selected/unselected) but found ${optionFcCounts.size} — choice answers may be unreliable.`
    );
  }

  // Scale (linear 1-10) answers: resolve each page that has scale questions
  // and zip detected filled-dot positions (top-to-bottom) to the scale
  // questions encountered on that page (also top-to-bottom, in document order).
  const scaleByPage = new Map<number, Question[]>();
  for (const ref of scaleQuestionRefs) {
    const arr = scaleByPage.get(ref.page) ?? [];
    if (!arr.includes(ref.question)) arr.push(ref.question);
    scaleByPage.set(ref.page, arr);
  }
  const scaleValues = new Map<Question, number>();
  Array.from(scaleByPage.entries()).forEach(([page, qs]) => {
    let hits: ScaleHit[] = [];
    try {
      hits = resolveScaleHits(page);
    } catch (err) {
      warnings.push(`Page ${page}: failed to resolve linear-scale answers (${(err as Error).message}).`);
      return;
    }
    if (hits.length !== qs.length) {
      warnings.push(`Page ${page}: found ${hits.length} filled scale dot(s) but expected ${qs.length} — some scale answers may be misaligned or missing.`);
    }
    const n = Math.min(hits.length, qs.length);
    for (let i = 0; i < n; i++) scaleValues.set(qs[i], hits[i].value);
  });

  // ── Build raw Q&A + verbatim raw_answers map ──
  const qa: { question: string; answer: string | string[] }[] = [];
  const rawAnswers: Record<string, string> = {};
  const identity: Identity = { name: null, username: null, telegramId: null, email: null };
  let fullName: string | null = null;
  let country: string | null = null;
  const structured = emptyStructured();

  for (const q of questions) {
    if (!q.label) continue;
    let answer: string | string[] | null = null;

    if (q.kind === 'choice' && q.options.length > 0) {
      const selected = selectedFc ? q.options.filter((o) => o.fc === selectedFc).map((o) => o.text) : [];
      if (selected.length === 0) {
        warnings.push(`Could not resolve a selected option for "${q.label}" — flagged for manual review.`);
      }
      answer = selected.length === 1 ? selected[0] : selected;
    } else if (q.kind === 'scale') {
      const v = scaleValues.get(q);
      if (v == null) {
        warnings.push(`Could not resolve a scale value for "${q.label}" — flagged for manual review.`);
      } else {
        answer = String(v);
      }
    } else {
      const text = q.freeTextLines.join(' ').trim();
      answer = text || null;
    }

    if (answer == null) continue;
    qa.push({ question: q.label, answer });
    rawAnswers[q.label] = Array.isArray(answer) ? answer.join(', ') : answer;

    const answerText = Array.isArray(answer) ? answer.join(', ') : answer;

    for (const [key, pattern] of Object.entries(IDENTITY_PATTERNS)) {
      if (!pattern.test(q.label)) continue;
      if (key === 'email') identity.email = answerText.toLowerCase();
      else if (key === 'username') identity.username = answerText.replace(/^@/, '').trim();
      else if (key === 'fullName') fullName = answerText;
      else if (key === 'country') country = answerText;
    }

    for (const [key, pattern] of Object.entries(STRUCTURED_PATTERNS)) {
      if (!pattern.test(q.label)) continue;
      switch (key) {
        case 'primaryIncomeSource':
          structured.primaryIncomeSource = answerText;
          break;
        case 'monthlyProfitUsd':
          structured.monthlyProfitUsd = parseUsd(answerText);
          break;
        case 'monthlyRevenueUsd':
          structured.monthlyRevenueUsd = parseUsd(answerText);
          break;
        case 'profitGoal6moUsd':
          structured.profitGoal6moUsd = parseUsd(answerText);
          break;
        case 'niche':
          structured.niche = answerText;
          break;
        case 'biggestProblem':
          structured.biggestProblem = answerText;
          break;
        case 'hasSalesFunnel':
          structured.hasSalesFunnel = parseYesNo(answerText);
          break;
        case 'ranPaidAds':
          structured.ranPaidAds = parseYesNo(answerText);
          break;
        case 'teamStructure':
          structured.teamStructure = teamStructureFromAnswer(answerText);
          break;
        case 'seriousnessLevel':
          structured.seriousnessLevel = Number(answerText) || null;
          break;
        case 'currentStage':
          structured.currentStage = currentStageFromAnswer(answerText);
          break;
        case 'contentCreation':
          structured.skillScores.content_creation = Number(answerText) || null;
          break;
        case 'copywriting':
          structured.skillScores.copywriting = Number(answerText) || null;
          break;
        case 'sales':
          structured.skillScores.sales = Number(answerText) || null;
          break;
        case 'offerCreation':
          structured.skillScores.offer_creation = Number(answerText) || null;
          break;
        case 'audienceGrowth':
          structured.skillScores.audience_growth = Number(answerText) || null;
          break;
        case 'branding':
          structured.skillScores.branding = Number(answerText) || null;
          break;
        case 'marketing':
          structured.skillScores.marketing = Number(answerText) || null;
          break;
        case 'systemsAutomation':
          structured.skillScores.systems_automation = Number(answerText) || null;
          break;
      }
    }
  }

  identity.name = fullName;

  return { ...identity, fullName, country, qa, rawAnswers, structured, warnings };
}

export function emptyCustomPlanIntakeParsed(): CustomPlanIntakeParsed {
  return { name: null, username: null, telegramId: null, email: null, fullName: null, country: null, qa: [], rawAnswers: {}, warnings: [], structured: emptyStructured() };
}
