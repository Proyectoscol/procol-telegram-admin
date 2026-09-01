/**
 * Standalone verification of lib/import/customPlanIntakePdf.ts against the
 * real "NM Custom Plan Intake Form" PDF export fixture — this is the primary
 * upload path (the app converts the PDF itself; users don't upload HTML).
 * Run with:
 *   npx tsx scripts/verify-custom-plan-intake-pdf-parser.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseCustomPlanIntakePdf } from '../lib/import/customPlanIntakePdf';
import { runChecks } from './verify-custom-plan-intake-checks';

async function main() {
  const buf = readFileSync(join(__dirname, '../lib/import/__fixtures__/custom-plan-intake-sample.pdf'));
  const parsed = await parseCustomPlanIntakePdf(buf);
  const failures = runChecks(parsed);
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
