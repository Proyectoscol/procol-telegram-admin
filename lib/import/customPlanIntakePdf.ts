/**
 * "NM Custom Plan Intake Form" PDF parser — reads the Google Forms PDF
 * export directly (no manual PDF→HTML conversion step for the user). Reuses
 * the shared question-grouping/keyword-matching logic in
 * lib/import/customPlanIntakeShared.ts; this file only turns the PDF's
 * content stream into the same LeafDiv[] shape the HTML parser produces,
 * plus a scale-question ("very low ↔ very high" 1-10 sliders) resolver.
 *
 * Two things this form's PDF encodes that plain PDF text extraction misses:
 *
 * 1. Which radio/checkbox option is selected. Every option's text is drawn
 *    with `setFillRGBColor` right before it, and the selected option uses a
 *    distinct (but visually near-identical on screen) color from the
 *    unselected ones — same signal the HTML/pdf2htmlEX path relies on, read
 *    directly off the PDF operator list here instead of a CSS class. Which
 *    of the two colors means "selected" is derived per-document (the
 *    minority color across all option runs), not hardcoded, since it's an
 *    artifact of the PDF's internal color table.
 *
 * 2. The 1-10 linear-scale answers (skill sliders, "Seriousness Level").
 *    These aren't text at all — Google draws the scale as 10 vector circles
 *    per question, and fills the selected one with a distinct color. Those
 *    circles are found directly in the operator list too (a `constructPath`
 *    call, not a rasterized image), by grouping same-row circles and
 *    checking which one was drawn with the (again, per-document-derived)
 *    "selected" fill color.
 */
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { assembleCustomPlanIntake, type CustomPlanIntakeParsed, type LeafDiv, type ScaleHit } from '@/lib/import/customPlanIntakeShared';

export type { CustomPlanIntakeParsed, SkillScores, CustomPlanIntakeStructured } from '@/lib/import/customPlanIntakeShared';

const OPS = pdfjsLib.OPS;

function cleanText(raw: string): string {
  // Same ligature normalization the HTML path needs — this PDF's font
  // renders "fi"/"fl" as single ligature glyphs (U+FB01/FB02); left alone,
  // "proﬁt" doesn't match /profit/i.
  return raw.replace(/\s+/g, ' ').trim().replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl');
}

interface PathCandidate {
  x0: number;
  y0: number;
  fill: string;
}

/** Walk one page's operator list, producing its positioned text runs and candidate "dot" fill paths in one pass. */
function extractPage(pageNum: number, fnArray: number[], argsArray: unknown[]): { leaves: LeafDiv[]; paths: PathCandidate[] } {
  const leaves: LeafDiv[] = [];
  const paths: PathCandidate[] = [];

  let currentFill = 'unknown';
  let currentFont = { name: '', size: 0 };
  let inText = false;
  let textX: number | null = null;
  let textY: number | null = null;
  let textFillAtStart = 'unknown';
  let buffer = '';
  let lastRawY: number | null = null;

  for (let i = 0; i < fnArray.length; i++) {
    const op = fnArray[i];
    const args = argsArray[i] as unknown;

    if (
      op === OPS.setFillRGBColor ||
      op === OPS.setFillGray ||
      op === OPS.setFillCMYKColor ||
      op === OPS.setFillColorN ||
      op === OPS.setFillColor
    ) {
      // Every operator's params arrive as a wrapping array — pdf.js's
      // OperatorList pre-resolves fill colors to a single CSS-style value
      // (e.g. "#5746e3") regardless of the underlying color model, so args[0]
      // is enough as an opaque "current fill" key.
      currentFill = String((args as unknown[])[0]);
    } else if (op === OPS.setFont) {
      const [name, size] = args as [string, number];
      currentFont = { name, size };
    } else if (op === OPS.beginText) {
      inText = true;
      textX = null;
      textY = null;
      textFillAtStart = currentFill;
      buffer = '';
    } else if (op === OPS.setTextMatrix) {
      const m = (args as unknown[])[0] as { [k: number]: number };
      if (textX === null) {
        textX = m[4];
        textY = m[5];
      }
    } else if (op === OPS.showText && inText) {
      const glyphs = (args as unknown[])[0] as { unicode?: string }[];
      for (const g of glyphs) buffer += g.unicode ?? '';
    } else if (op === OPS.endText) {
      inText = false;
      const text = cleanText(buffer);
      const prev = leaves[leaves.length - 1];
      const sameLineAsPrev = prev && prev.page === pageNum && lastRawY === textY;
      if (text === '*' && sameLineAsPrev) {
        // The Google Forms required-field marker "*" is drawn as its own
        // beginText/endText block (a different font/color from the label),
        // immediately after the label it belongs to — unlike the HTML
        // export, where it's a nested span inside the same div. Merge it in
        // so the shared grouping logic's "*"-terminated label detection
        // (see customPlanIntakeShared.ts) works the same way.
        prev.text = `${prev.text} *`;
      } else if (sameLineAsPrev && prev.ff === currentFont.name && prev.fc === textFillAtStart) {
        // Some labels get split mid-word across multiple beginText/endText
        // blocks that are otherwise identical in every way (same line, same
        // font, same color) — a PDF-generator quirk with no HTML/pdf2htmlEX
        // equivalent, seen e.g. on "Telegram username:" splitting into
        // "Telegram use" + "rname:". Glue continuations back together.
        prev.text += text;
      } else if (text.length > 0 && textX !== null && textY !== null) {
        lastRawY = textY;
        leaves.push({
          page: pageNum,
          x: textX,
          // The shared grouping logic sorts by descending y expecting
          // "top of page first" (matching the HTML parser's CSS bottom-
          // offset convention); this PDF's raw text-matrix y increases
          // top-to-bottom instead, so negate it to match.
          y: -textY,
          ff: currentFont.name,
          fs: currentFont.size.toFixed(2),
          fc: textFillAtStart,
          text,
        });
      }
    } else if (op === OPS.constructPath) {
      const [, subpaths] = args as [unknown, number[][]];
      const first = subpaths?.[0];
      if (first && first.length >= 3) {
        paths.push({ x0: first[1], y0: first[2], fill: currentFill });
      }
    }
  }

  return { leaves, paths };
}

/**
 * Groups same-row "dot" path candidates into linear-scale widgets (exactly
 * 10 evenly-drawn circles sharing one row) and resolves each row's selected
 * value once the document-wide "selected" fill color is known.
 */
function findScaleRows(paths: PathCandidate[]): { y0: number; circles: PathCandidate[] }[] {
  const byY = new Map<number, PathCandidate[]>();
  for (const p of paths) {
    const arr = byY.get(p.y0) ?? [];
    arr.push(p);
    byY.set(p.y0, arr);
  }
  const rows: { y0: number; circles: PathCandidate[] }[] = [];
  byY.forEach((circles, y0) => {
    if (circles.length !== 10) return; // a linear-scale row always draws exactly 10 circles
    const distinctFills = new Set(circles.map((c) => c.fill));
    if (distinctFills.size !== 2) return;
    rows.push({ y0, circles: [...circles].sort((a, b) => a.x0 - b.x0) });
  });
  // Ascending y0 is top-to-bottom in this PDF's local path coordinate space
  // (verified against the real fixture: an earlier question's scale row has
  // a smaller y0 than a later question's).
  rows.sort((a, b) => a.y0 - b.y0);
  return rows;
}

export async function parseCustomPlanIntakePdf(pdfBuffer: Buffer): Promise<CustomPlanIntakeParsed> {
  const warnings: string[] = [];
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer), useSystemFonts: true }).promise;

  const allLeaves: LeafDiv[] = [];
  const pathsByPage = new Map<number, PathCandidate[]>();

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const opList = await page.getOperatorList();
    const { leaves, paths } = extractPage(pageNum, Array.from(opList.fnArray), opList.argsArray);
    allLeaves.push(...leaves);
    pathsByPage.set(pageNum, paths);
  }

  if (allLeaves.length === 0) {
    warnings.push('No recognizable form content found in this PDF — is this a Google Forms response export?');
  }

  // Derive the "selected" scale-dot color the same way as choice options:
  // the minority fill color across every qualifying 10-circle row in the
  // whole document (only one of ten is ever selected per row).
  const rowsByPage = new Map<number, { y0: number; circles: PathCandidate[] }[]>();
  const fillCounts = new Map<string, number>();
  pathsByPage.forEach((paths, page) => {
    const rows = findScaleRows(paths);
    rowsByPage.set(page, rows);
    for (const row of rows) for (const c of row.circles) fillCounts.set(c.fill, (fillCounts.get(c.fill) ?? 0) + 1);
  });
  let selectedDotFill: string | null = null;
  if (fillCounts.size === 2) {
    selectedDotFill = Array.from(fillCounts.entries()).sort((a, b) => a[1] - b[1])[0][0];
  } else if (fillCounts.size > 0) {
    warnings.push(`Expected exactly 2 distinct linear-scale dot colors (selected/unselected) but found ${fillCounts.size} — scale answers may be unreliable.`);
  }

  return assembleCustomPlanIntake(
    allLeaves,
    (page) => {
      const rows = rowsByPage.get(page);
      if (!rows || rows.length === 0) throw new Error('no linear-scale dot rows found on this page');
      const hits: ScaleHit[] = [];
      for (const row of rows) {
        const idx = selectedDotFill ? row.circles.findIndex((c) => c.fill === selectedDotFill) : -1;
        if (idx >= 0) hits.push({ page, value: idx + 1 });
      }
      return hits;
    },
    warnings
  );
}
