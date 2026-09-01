/**
 * "NM Custom Plan Intake Form" HTML (pdf2htmlEX PDF→HTML export) parser.
 * Kept as a fallback input path — the primary path is the direct PDF parser
 * (lib/import/customPlanIntakePdf.ts), which the app now converts server-side.
 * This file only extracts positioned text runs + per-page background images
 * from the HTML; the actual question-grouping/keyword-matching logic is
 * shared with the PDF parser in lib/import/customPlanIntakeShared.ts.
 *
 * Plain PDF text extraction loses which radio/checkbox option was selected
 * — every option prints as plain text with no marker — but pdf2htmlEX's
 * HTML export keeps per-span text color, and renders the selected option in
 * a distinct (but visually near-identical) text color from the unselected
 * ones. The shared module re-derives that "selected" color per document
 * rather than hardcoding it, since the exact class name/color is an
 * artifact of the PDF's internal color table and can differ between exports.
 *
 * Linear-scale questions (the 1-10 skill sliders, "Seriousness Level") are a
 * different Google Forms widget: the filled dot is drawn into the page's
 * rasterized background image, not as colored text. Those are recovered by
 * decoding that per-page PNG and finding the filled dot among the 10 evenly
 * spaced circles on the question's row.
 */
import { PNG } from 'pngjs';
import { assembleCustomPlanIntake, type CustomPlanIntakeParsed, type LeafDiv, type ScaleHit } from '@/lib/import/customPlanIntakeShared';

export type { CustomPlanIntakeParsed, SkillScores, CustomPlanIntakeStructured } from '@/lib/import/customPlanIntakeShared';

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

function detectScaleHitsFromImage(page: number, png: PNG): ScaleHit[] {
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

  // 2. Cluster into blobs (points within 6px count as the same blob) — a
  // filled dot is a small solid disc, a few hundred pixels, so a tight
  // proximity clustering is enough.
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

  const hits: { y: number; value: number }[] = [];
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
    hits.push({ y: cy, value });
  }

  // Top-to-bottom on the page, matching reading order — image pixel y
  // increases downward (row 0 is the top), so ascending y is top-to-bottom.
  hits.sort((a, b) => a.y - b.y);
  return hits.map((h) => ({ page, value: h.value }));
}

export function parseCustomPlanIntakeHtml(html: string): CustomPlanIntakeParsed {
  const warnings: string[] = [];
  const { leaves, pageImages } = extractLeafDivs(html);
  if (leaves.length === 0) {
    warnings.push('No recognizable form content found in this HTML export — is this a pdf2htmlEX PDF→HTML conversion?');
  }

  return assembleCustomPlanIntake(
    leaves,
    (page) => {
      const imgBuf = pageImages.get(page);
      if (!imgBuf) throw new Error('no background image found on this page to read the selected value from');
      const png = PNG.sync.read(imgBuf);
      return detectScaleHitsFromImage(page, png);
    },
    warnings
  );
}
