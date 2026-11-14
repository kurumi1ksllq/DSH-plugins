// issue-206 (axis-1 review P1-2): the Chinese fallback must be reachable from the
// path deep-ptc sessions actually use.
//
// Measured before this fix: deep_ptc_tools({action:'skills', query:'跑测试'}) returned
// {total:0} while skill_get — where the fallback lived — was hidden from every agent
// that has the official loader. The curated table therefore never ran in the one
// composition this whole issue is about.
//
// These tests call the REAL exported helper. An earlier draft re-implemented it in
// the test, which made the assertions vacuous — the same mistake axis-1 flagged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const PROFILE = '/root/.dsh/profiles/web/package.json';
const resolvable = existsSync(PROFILE);

// The production lookup resolves from the profile that owns both bundles; a bare
// specifier fails because deep-ptc does not depend on skill-surface.
const baseUrl = PROFILE;

const rows = (...names) => names.map(name => ({ name, description: name + ' description.' }));

test('a Chinese query with no lexical hits still yields catalog names', { skip: !resolvable }, async () => {
  const { intentFallback } = await import('../lib/skill-intent.mjs');
  const got = await intentFallback('跑一下测试看看', rows('tdd-workflow', 'test-coverage', 'unrelated'), baseUrl);
  assert.ok(got.includes('tdd-workflow'), `got ${got.join(',')}`);
  assert.ok(got.includes('test-coverage'));
});

test('a name the live catalog does not have is never returned', { skip: !resolvable }, async () => {
  // The table also names python-testing/react-testing; this call has neither.
  const { intentFallback } = await import('../lib/skill-intent.mjs');
  const got = await intentFallback('写个单元测试', rows('tdd-workflow'), baseUrl);
  assert.deepEqual(got, ['tdd-workflow']);
});

test('an unmatched query stays empty so the caller keeps the lexical answer', { skip: !resolvable }, async () => {
  const { intentFallback } = await import('../lib/skill-intent.mjs');
  assert.deepEqual(await intentFallback('今天天气不错', rows('tdd-workflow'), baseUrl), []);
  assert.deepEqual(await intentFallback('', rows('tdd-workflow'), baseUrl), []);
});

test('a missing base resolves to nothing instead of throwing', { skip: !resolvable }, async () => {
  // The optional package must never cost the caller its lexical answer.
  const { intentFallback } = await import('../lib/skill-intent.mjs');
  assert.deepEqual(await intentFallback('跑测试', rows('tdd-workflow'), undefined), []);
});
