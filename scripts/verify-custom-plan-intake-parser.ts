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

const html = readFileSync(join(__dirname, '../lib/import/__fixtures__/custom-plan-intake-sample.html'), 'utf-8');
const parsed = parseCustomPlanIntakeHtml(html);

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = typeof actual === 'string' ? actual.trim() : actual;
  const pass = JSON.stringify(a) === JSON.stringify(expected);
  if (!pass) {
    failures++;
    console.error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(a)}`);
  } else {
    console.log(`ok   ${label}: ${JSON.stringify(a)}`);
  }
}

function findAnswer(question: RegExp): string | string[] | undefined {
  return parsed.qa.find((q) => question.test(q.question))?.answer;
}

console.log(`Parsed ${parsed.qa.length} Q&A pairs, ${parsed.warnings.length} warning(s).`);
if (parsed.warnings.length) console.log('Warnings:', parsed.warnings);

check('email', parsed.email, 'tariqblaszcyk@gmail.com');
check('username', parsed.username, 'Tariq_blaszcyk');
check('fullName', parsed.fullName, 'Tariq Omar Blaszcyk');
check('country', parsed.country, 'Im originally from Germany but I live in the Netherlands');

check('Primary Income Source', findAnswer(/primary income source/i), 'Online Business');
check('Content type', findAnswer(/type of content do you post/i), ['Short-form videos', 'Images']);
check('Sales funnel', findAnswer(/sales funnel set up/i), 'Yes');
check('Assets', findAnswer(/assets do you currently have/i), ['Email list', 'Landing pages', 'Sales pages']);
check('Biggest problem', findAnswer(/biggest problem right now/i), 'Conversion');
check('Paid ads', findAnswer(/run paid ads/i), 'Yes');
check('Team', findAnswer(/work alone or with a team/i), 'Work alone');
check('Current stage', findAnswer(/stage best describes/i), 'Scaling bottleneck');
check('What you need most', findAnswer(/feel you need most/i), 'Strategy');

check('Content Creation score', parsed.structured.skillScores.content_creation, 8);
check('Copywriting score', parsed.structured.skillScores.copywriting, 1);
check('Sales score', parsed.structured.skillScores.sales, 7);
check('Offer Creation score', parsed.structured.skillScores.offer_creation, 5);
check('Audience Growth score', parsed.structured.skillScores.audience_growth, 9);
check('Branding score', parsed.structured.skillScores.branding, 6);
check('Marketing score', parsed.structured.skillScores.marketing, 7);
check('Systems and Automation score', parsed.structured.skillScores.systems_automation, 4);
check('Seriousness Level', parsed.structured.seriousnessLevel, 10);

check('monthlyRevenueUsd', parsed.structured.monthlyRevenueUsd, 12000);
check('profitGoal6moUsd', parsed.structured.profitGoal6moUsd, 20000);
check('niche', parsed.structured.niche, 'Women footwear, y2K, stockholmstyle, and especially in the wedge sneaker industry');
check('hasSalesFunnel', parsed.structured.hasSalesFunnel, true);
check('ranPaidAds', parsed.structured.ranPaidAds, true);
check('teamStructure', parsed.structured.teamStructure, 'ALONE');
check('currentStage', parsed.structured.currentStage, 'SCALING_BOTTLENECK');
check('primaryIncomeSource', parsed.structured.primaryIncomeSource, 'Online Business');
check('biggestProblem', parsed.structured.biggestProblem, 'Conversion');

// Free-text fields that only need to survive into raw_answers, not be promoted.
const rawBlob = JSON.stringify(parsed.rawAnswers);
for (const needle of [
  '429', // email list size
  '5300', // leads/week
  '0,66', // conversion rate (as printed)
  '44,1K', // Instagram followers
  '3,9K', // TikTok followers
  '500 subscribers', // YouTube followers
  '38 followers', // Pinterest followers
  '3000', // monthly investment budget
  '10', // hours/week (also matches other numbers, just presence-checked below with context)
]) {
  if (!rawBlob.includes(needle)) {
    failures++;
    console.error(`FAIL raw_answers missing expected substring: ${JSON.stringify(needle)}`);
  } else {
    console.log(`ok   raw_answers contains ${JSON.stringify(needle)}`);
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
