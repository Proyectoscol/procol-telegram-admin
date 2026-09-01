/**
 * Standalone verification of lib/import/customPlanIntakeHtml.ts against the
 * real "NM Custom Plan Intake Form" HTML export fixture. Run with:
 *   npx tsx scripts/verify-custom-plan-intake-parser.ts
 * There's no test runner configured in this project, so this is a plain
 * script that exits non-zero on any mismatch instead of a jest/vitest suite.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseCustomPlanIntakeHtml } from '../lib/import/customPlanIntakeHtml';
import { runChecks } from './verify-custom-plan-intake-checks';

const html = readFileSync(join(__dirname, '../lib/import/__fixtures__/custom-plan-intake-sample.html'), 'utf-8');
const parsed = parseCustomPlanIntakeHtml(html);
const failures = runChecks(parsed);
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
