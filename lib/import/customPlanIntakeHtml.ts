/**
 * "NM Custom Plan Intake Form" (Google Forms) importer: users export the
 * form response to PDF, then convert that PDF to HTML with any PDF→HTML
 * tool (this was built and verified against pdf2htmlEX output). Plain PDF
 * text extraction loses which radio/checkbox option was selected — every
 * option prints as plain text with no marker — but the HTML export keeps
 * per-span text color, and pdf2htmlEX (and similar tools) render the
 * selected option in a distinct (but visually near-identical) text color
 * from the unselected ones. This file re-derives that "selected" color per
 * document rather than hardcoding it, since the exact class name/color is
 * an artifact of the PDF's internal color table and can differ between
 * exports.
 *
 * Linear-scale questions (the 1-10 skill sliders, "Seriousness Level") are
 * a different Google Forms widget: the filled dot is drawn into the page's
 * rasterized background image, not as colored text. Those are recovered by
 * decoding that per-page PNG and finding the filled dot among the 10 evenly
 * spaced circles on the question's row.
 */
import { PNG } from 'pngjs';
import type { Identity } from '@/lib/import/matching';

// ── HTML entity + text cleanup ──────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function cleanLeafText(inner: string): string {
  // pdf2htmlEX wraps kerning-adjustment spacer spans and inline style spans
  // (e.g. the red required-marker "*") inside each text div — strip the tags,
  // keep any text content, then decode entities.
  const noTags = inner.replace(/<[^>]+>/g, '');
  const decoded = decodeEntities(noTags).replace(/\s+/g, ' ').trim();
  // The PDF's font renders "fi"/"fl" as ligature glyphs (U+FB01/FB02) instead
  // of the two plain letters — left alone, "proﬁt" doesn't match /profit/i.
  return decoded.replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl');
}

// ── Per-page pixel-position lookup (pdf2htmlEX emits `.x7{left:12px;}` /
// `.y7{bottom:34px;}` rules in <style> blocks) ──────────────────────────────

function buildPxMap(css: string): { x: Map<string, number>; y: Map<string, number> } {
  const x = new Map<string, number>();
  const y = new Map<string, number>();
  const re = /\.([xy][0-9a-f]+)\{(?:left|bottom):(-?[\d.]+)px;\}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const [, cls, val] = m;
    (cls[0] === 'x' ? x : y).set(cls, parseFloat(val));
  }
  return { x, y };
}

// ── Leaf text-div extraction ────────────────────────────────────────────────

interface LeafDiv {
  page: number;
  x: number;
  y: number;
  ff: string;
  fs: string;
  fc: string;
  text: string;
}

const LEAF_DIV_RE = /<div class="(t m0[^"]*)">([\s\S]*?)<\/div>/g;
// pdf2htmlEX numbers pages in hex once past 9 (pf9, pfa, pfb, ...) — the
// same convention it uses for x/y position classes. Matching only \d+ here
// silently drops every page from 10 onward, which then merges two or more
// real pages' content into whatever the last matched page happened to be —
// their y-coordinates legitimately overlap (each page reuses the same
// range), so the merged content sorts into an interleaved, unusable order.
const PAGE_START_RE = /<div id="pf([0-9a-f]+)" class="pf w0 h0" data-page-no="[0-9a-f]+">/g;

function tokenOf(classes: string[], prefix: 'x' | 'y' | 'ff' | 'fs' | 'fc'): string {
  const re = prefix === 'x' || prefix === 'y' ? new RegExp(`^${prefix}[0-9a-f]+$`) : new RegExp(`^${prefix}\\d+$`);
  return classes.find((c) => re.test(c)) ?? '';
}

function extractLeafDivs(html: string): { leaves: LeafDiv[]; pageImages: Map<number, Buffer> } {
  const { x: xMap, y: yMap } = buildPxMap(html);
  const pageImages = new Map<number, Buffer>();

  // Split into per-page chunks so each leaf div can be tagged with its page
  // number, and each page's first embedded PNG (the rasterized background —
  // this is where linear-scale selections live) can be captured.
  const starts: { page: number; index: number }[] = [];
  let sm: RegExpExecArray | null;
  const startRe = new RegExp(PAGE_START_RE.source, 'g');
  while ((sm = startRe.exec(html))) starts.push({ page: parseInt(sm[1], 16), index: sm.index });

  const leaves: LeafDiv[] = [];
  for (let i = 0; i < starts.length; i++) {
    const page = starts[i].page;
    const chunkStart = starts[i].index;
    const chunkEnd = i + 1 < starts.length ? starts[i + 1].index : html.length;
    const chunk = html.slice(chunkStart, chunkEnd);

    const imgMatch = /src="data:image\/png;base64,([^"]+)"/.exec(chunk);
    if (imgMatch) pageImages.set(page, Buffer.from(imgMatch[1], 'base64'));

    const leafRe = new RegExp(LEAF_DIV_RE.source, 'g');
    let lm: RegExpExecArray | null;
    while ((lm = leafRe.exec(chunk))) {
      const classes = lm[1].split(/\s+/);
      const xCls = tokenOf(classes, 'x');
      const yCls = tokenOf(classes, 'y');
      leaves.push({
        page,
        x: xMap.get(xCls) ?? -1,
        y: yMap.get(yCls) ?? -1,
        ff: tokenOf(classes, 'ff'),
        fs: tokenOf(classes, 'fs'),
        fc: tokenOf(classes, 'fc'),
        text: cleanLeafText(lm[2]),
      });
    }
  }

  return { leaves, pageImages };
}

// ── Scale-widget pixel detection ────────────────────────────────────────────
// Every "very low ↔ very high" linear-scale question renders as 10 evenly
// spaced circles; the selected one is filled with a saturated color while
// the other nine are hollow (white center, grey ring only). We don't know
// that fill color ahead of time, so we scan for any strongly-colored
// (non-grey, non-white) pixel cluster, then figure out which of the 10
// circle slots on that row it falls in.

interface ScaleHit {
  page: number;
  y: number;
  value: number; // 1-10
}

function isNearWhite(r: number, g: number, b: number): boolean {
  return r > 245 && g > 245 && b > 245;
}

function isGray(r: number, g: number, b: number): boolean {
  // The unfilled circle ring's anti-aliased edge pixels blend gray with
  // white and can land right at a narrow threshold's boundary (e.g.
  // (154,160,166) has an r/b delta of exactly 12) — a filled dot's color is
  // far more saturated than this in every real sample seen, so a wide
  // margin here doesn't risk misclassifying it.
  return Math.abs(r - g) < 20 && Math.abs(g - b) < 20 && Math.abs(r - b) < 20;
}

function detectScaleHits(page: number, png: PNG): ScaleHit[] {
  const { width, height, data } = png;
  const at = (x: number, y: number): [number, number, number] => {
    const idx = (width * y + x) << 2;
    return [data[idx], data[idx + 1], data[idx + 2]];
  };

  // 1. Find colored (non-white, non-gray) pixels — candidate "filled dot" pixels.
  const colored: { x: number; y: number }[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = at(x, y);
      if (!isNearWhite(r, g, b) && !isGray(r, g, b)) colored.push({ x, y });
    }
  }
  if (colored.length === 0) return [];

  // 2. Cluster into blobs (rows within 6px count as the same blob vertically,
  // columns within 6px horizontally) — a filled dot is a small solid disc, a
  // few hundred pixels, so a tight proximity clustering is enough.
  const blobs: { xs: number[]; ys: number[] }[] = [];
  const used = new Array(colored.length).fill(false);
  for (let i = 0; i < colored.length; i++) {
    if (used[i]) continue;
    const stack = [i];
    used[i] = true;
    const xs: number[] = [];
    const ys: number[] = [];
    while (stack.length) {
      const idx = stack.pop()!;
      xs.push(colored[idx].x);
      ys.push(colored[idx].y);
      for (let j = 0; j < colored.length; j++) {
        if (used[j]) continue;
        if (Math.abs(colored[j].x - colored[idx].x) <= 6 && Math.abs(colored[j].y - colored[idx].y) <= 6) {
          used[j] = true;
          stack.push(j);
        }
      }
    }
    blobs.push({ xs, ys });
  }

  const hits: ScaleHit[] = [];
  for (const blob of blobs) {
    const cx = blob.xs.reduce((a, b) => a + b, 0) / blob.xs.length;
    const cy = blob.ys.reduce((a, b) => a + b, 0) / blob.ys.length;

    // 3. Find the 10 circle x-centers on this same row by scanning a
    // horizontal band around cy for non-white pixels (grey rings + the
    // fill itself) and clustering by x-gap.
    const bandTop = Math.max(0, Math.round(cy - 16));
    const bandBottom = Math.min(height - 1, Math.round(cy + 16));
    const colHasContent = new Array(width).fill(false);
    for (let x = 0; x < width; x++) {
      for (let y = bandTop; y <= bandBottom; y++) {
        const [r, g, b] = at(x, y);
        if (!isNearWhite(r, g, b)) {
          colHasContent[x] = true;
          break;
        }
      }
    }
    const xClusters: number[][] = [];
    let current: number[] = [];
    for (let x = 0; x < width; x++) {
      if (colHasContent[x]) {
        current.push(x);
      } else if (current.length) {
        xClusters.push(current);
        current = [];
      }
    }
    if (current.length) xClusters.push(current);
    // Circle clusters are ~25-35px wide; drop stray 1-2px slivers (card
    // border corners, antialiasing noise) that aren't real dot columns.
    const circleClusters = xClusters.filter((c) => c.length >= 10);
    if (circleClusters.length < 2) continue; // not a recognizable 10-dot row

    const centers = circleClusters.map((c) => (c[0] + c[c.length - 1]) / 2);
    let bestIdx = 0;
    let bestDist = Infinity;
    centers.forEach((c, i) => {
      const d = Math.abs(c - cx);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    });
    // Map the matched slot back onto a 1-10 value using its position among
    // the detected circles (handles a scale rendered with fewer/more than
    // 10 visible circles due to cropping at page edges, best-effort).
    const value = centers.length === 10 ? bestIdx + 1 : Math.round((bestIdx / (centers.length - 1)) * 9) + 1;
    hits.push({ page, y: cy, value });
  }

  // Top-to-bottom on the page, matching reading order — image pixel y
  // increases downward (row 0 is the top), so ascending y is top-to-bottom.
  hits.sort((a, b) => a.y - b.y);
  return hits;
}

// ── Question grouping ────────────────────────────────────────────────────────

// The Google Forms required-field marker is usually a literal "*", but this
// PDF's subset font renders it (for at least one label) as a Private-Use-Area
// glyph instead — pdf2htmlEX maps characters missing a normal Unicode
// codepoint in the subsetted font into U+E000-U+F8FF. Strip either form.
function stripRequiredMarker(text: string): string {
  // The marker is usually a literal "*", but this PDF's subset font
  // renders it (for at least one label) as a Private-Use-Area glyph
  // instead (pdf2htmlEX maps characters missing from the subsetted font's
  // normal Unicode range into U+E000-U+F8FF) — strip either form, plus any
  // adjoining whitespace, from the end of the label text.
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
// have their answer represented as text — the filled dot is drawn into the
// page's background image (see detectScaleHits). These labels are known and
// fixed for this specific form, so they're recognized by keyword up front,
// rather than inferred from trailing tick-mark text, which turned out to be
// unreliable: pdf2htmlEX can place several short adjacent question labels at
// the exact same y position on a dense page, and the general
// position-sorted grouping below can't tell which of several tied labels a
// given trailing line belongs to.
const SCALE_LABEL_PATTERNS: Record<string, RegExp> = {
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

interface Question {
  label: string;
  kind: 'choice' | 'freetext' | 'scale';
  freeTextLines: string[];
  options: { text: string; fc: string }[];
}

function groupQuestions(leaves: LeafDiv[]): { questions: Question[]; scaleQuestionRefs: { page: number; question: Question }[] } {
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

  // Option runs: consecutive divs sharing the exact same page+x (the same
  // CSS position class — real option columns always reuse the identical
  // class, so exact equality is deliberate: a "close enough" tolerance here
  // previously mis-merged a free-text answer with an unrelated section
  // header that happened to sit at a nearby x), in a run of >= 2, whose fc
  // values are confined to exactly two distinct values, are the
  // "selected"/"unselected" pair for a choice question. Which of the two
  // means "selected" is resolved later, by frequency across the whole
  // document (the caller aggregates every question's options for that).
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
    if (current.kind === 'scale') continue; // answer comes from the page image, not text
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

  // Scale questions' answers come from the page's background image, not
  // from text that follows the label, so they're paired up separately using
  // the RAW (unsorted) document order rather than the position-sorted order
  // above. On a dense page with several short scale questions back to back,
  // pdf2htmlEX can assign more than one label the exact same y position (a
  // shared baseline row), which makes the position sort's left-to-right,
  // top-to-bottom order ambiguous between them — but the underlying HTML
  // stream still emits labels in correct top-to-bottom reading order.
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

export function parseCustomPlanIntakeHtml(html: string): CustomPlanIntakeParsed {
  const warnings: string[] = [];
  const { leaves, pageImages } = extractLeafDivs(html);
  if (leaves.length === 0) {
    warnings.push('No recognizable form content found in this HTML export — is this a pdf2htmlEX PDF→HTML conversion?');
  }

  const { questions, scaleQuestionRefs } = groupQuestions(leaves);

  // Resolve the selected option's fc value the same way groupQuestions
  // derives it, so choice answers can be read off directly.
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

  // Scale (linear 1-10) answers: decode each page that has scale questions
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
    const imgBuf = pageImages.get(page);
    if (!imgBuf) {
      warnings.push(`Page ${page} has ${qs.length} linear-scale question(s) but no background image was found to read the selected value from.`);
      return;
    }
    let hits: ScaleHit[] = [];
    try {
      const png = PNG.sync.read(imgBuf);
      hits = detectScaleHits(page, png);
    } catch (err) {
      warnings.push(`Page ${page}: failed to decode background image for scale detection (${(err as Error).message}).`);
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
  const structured: CustomPlanIntakeStructured = {
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
