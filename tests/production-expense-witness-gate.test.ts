import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { preflightAcceptanceChecks, runGate } from '../server/gate.js';
import { preflightAcceptanceSemantics } from '../server/production/acceptance-preflight.js';
import { expenseChecks, expenseHtml, expenseMutants, expenseSource, type ExpenseMutant } from './fixtures/production-expense-witness.js';

// All HTML and checks below are explicitly hand-written test fixtures. No
// production task/store/API, SDK, model answer, candidate or billable call is
// created. Mutant failures are expected engineering evidence, NOT failed real
// attempts; a fixture pass is NOT autonomous software production.
const targets: Record<ExpenseMutant, number> = {
  'placeholder': 2, 'inputs-not-cleared': 6, 'wrong-category': 6,
  'filter-leaks': 7, 'filter-mutates': 7, 'filtered-total': 7,
  'concat': 8, 'float-tail': 8, 'reject-lower': 9, 'reject-upper': 9, 'aggregate-cap': 9,
  'accept-negative': 0, 'accept-zero': 0, 'accept-empty': 1, 'round-precision': 1, 'accept-over-upper': 2,
  'accept-blank': 10, 'accept-spaces': 10, 'reject-clears': 3, 'reject-description': 3,
  'reject-category': 3, 'reject-amount': 3, 'reject-total': 3, 'reject-subtotal': 3,
  'hidden-hint': 0, 'first-hint-only': 0, 'stale-hint-only': 0,
  'filtered-delete-all': 11, 'delete-wrong': 8, 'last-total-stale': 11, 'empty-category-subtotal': 9, 'hidden-ledger': 6,
  'transient-reject-content': 3, 'transient-reject-count': 3, 'transient-reject-total': 3, 'transient-reject-subtotal': 3,
};

test('expense witness actual CSS and semantic preflight keep the original eight-clause source', async () => {
  const checks = expenseChecks();
  assert.deepEqual(await preflightAcceptanceChecks(checks), { valid: true, errors: [] });
  assert.equal(preflightAcceptanceSemantics(checks, { capability: 'offline-single-html', ...expenseSource() }).valid, true);
});

test('handwritten full eight-clause witness passes the UNMODIFIED controlled Chromium Gate', async t => {
  const started = performance.now();
  const result = await runGate(expenseHtml(), expenseChecks());
  assert.equal(result.passed, true, JSON.stringify(result));
  assert.equal(result.checks.length, 13, 'Twelve authored checks plus the existing mandatory page check');
  t.diagnostic(JSON.stringify({ kind: 'test-owned-engineering-only', providerRequests: 0,
    authoredChecks: 12, elapsedMs: Math.round(performance.now() - started), result }));
});

test('every check also passes in reverse order with fresh pages, not borrowed previous state', async () => {
  const checks = expenseChecks();
  const result = await runGate(expenseHtml(), checks.reverse());
  assert.equal(result.passed, true, JSON.stringify(result));
});

test('ledger, amounts and feedback are real visible user content, not hidden test summaries or action text', async () => {
  // This independent fixture-design inspection does NOT add selectors, DOM
  // evaluation, reload or other new operations to the frozen Gate schema.
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort('blockedbyclient'));
    await page.setContent(expenseHtml());
    await page.locator('#description').fill('可见明细');
    await page.locator('#amount').fill('10.10');
    await page.locator('#add').click();
    assert.equal(await page.locator('#ledger').isVisible(), true);
    assert.equal(await page.locator('#feedback').isVisible(), true);
    assert.equal(await page.locator('#ledger').innerText(), '可见明细 ／ 办公 ／ 10.10');
    assert.equal(await page.locator('#ledger button, #ledger input, #ledger [hidden]').count(), 0);
    assert.equal(await page.locator('#ledger .record').count(), 1);
    assert.equal(await page.locator('#feedback').innerText(), '总额：10.10；当前小计：10.10');
    assert.equal(await page.locator('#category-office').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#delete-1').isVisible(), true);
    assert.equal(await page.locator('script[src], iframe, [data-test-pass], [data-digest]').count(), 0);
  } finally { await browser.close(); }
});

for (const mutant of expenseMutants) {
  test(`actual behavior mutant is rejected: ${mutant}`, async t => {
    const checks = expenseChecks(); const target = checks[targets[mutant]]!;
    // Run the specifically affected original check plus another original
    // independent check to preserve Gate's minimum two-check shape. We do NOT
    // claim all twelve were run against every mutant.
    const companion = checks[targets[mutant] === 6 ? 8 : 6]!;
    const started = performance.now();
    const result = await runGate(expenseHtml(mutant), [target, companion]);
    assert.equal(result.passed, false, `Surviving mutant ${mutant}: ${JSON.stringify(result)}`);
    const failed = result.checks.find(check => check.name === target.name);
    assert.equal(failed?.passed, false, `Target check did not detect ${mutant}: ${JSON.stringify(result)}`);
    t.diagnostic(JSON.stringify({ mutant, testOwnedOnly: true, fullSuite: false, authoredChecks: 2,
      target: target.name, elapsedMs: Math.round(performance.now() - started), result }));
  });
}
