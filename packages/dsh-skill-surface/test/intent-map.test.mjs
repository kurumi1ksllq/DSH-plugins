// issue-206: a Chinese-intent fallback for finding a skill name.
//
// The catalog describes skills in English; users ask in Chinese. Measured on
// 2026-11-14 against the live 272-entry catalog, lexical retrieval returned
// ZERO hits for 跑测试 / 单元测试 / 样式 / 鉴权 / 数据库迁移 / 部署 / 代码安全审查.
// A BM25 implementation reproduced the same failures and even ranked
// openclaw-persona-forge for 部署到生产环境.
//
// So this is deliberately NOT a search engine and NOT a per-turn injector: it is
// a small, curated intent→candidate table used only when the model asks for help.
// The model still decides. Every candidate must exist in the live catalog or it
// is dropped, so a stale table can never name a skill that is not there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { intentCandidates } from '../lib/intent-map.mjs';

const catalog = (...names) => new Set(names);

test('a Chinese testing request reaches the testing skills', () => {
  const got = intentCandidates('跑一下测试看看', catalog('tdd-workflow', 'test-coverage', 'other'));
  assert.ok(got.includes('tdd-workflow'));
  assert.ok(got.includes('test-coverage'));
});

test('candidates that the catalog does not have are dropped', () => {
  // The table may name skills this install does not ship; naming them would be a lie.
  const got = intentCandidates('跑一下测试看看', catalog('tdd-workflow'));
  assert.deepEqual(got, ['tdd-workflow']);
});

test('an unrelated request yields no candidates', () => {
  assert.deepEqual(intentCandidates('今天天气不错', catalog('tdd-workflow', 'security-review')), []);
});

test('empty or non-text input yields no candidates', () => {
  const all = catalog('tdd-workflow');
  assert.deepEqual(intentCandidates('', all), []);
  assert.deepEqual(intentCandidates('   ', all), []);
  assert.deepEqual(intentCandidates(undefined, all), []);
});

test('a security request reaches the security skills', () => {
  const got = intentCandidates('帮我加个登录鉴权', catalog('security-review', 'agent-security-hardening'));
  assert.ok(got.includes('security-review'));
});

test('candidates are capped so the hint stays a hint', () => {
  // Every skill the table names must be available, otherwise the cap is never
  // reached and this test would pass even with the cap removed.
  const all = catalog('tdd-workflow', 'test-coverage', 'python-testing', 'react-testing',
    'security-review', 'agent-security-hardening',
    'make-interfaces-feel-better', 'design-system', 'frontend-design-direction', 'accessibility',
    'react-patterns', 'vue-patterns', 'frontend-patterns', 'react-performance',
    'database-migrations', 'postgres-patterns', 'mysql-patterns',
    'api-design', 'backend-patterns',
    'deployment-patterns', 'docker-patterns');
  const got = intentCandidates('测试 样式 鉴权 部署 迁移 接口 react', all);
  assert.equal(got.length, 5, `expected the cap, got ${got.length}`);
});

test('a Vue request does not lead with React skills', () => {
  // domains.mjs already learned this: suggesting react-patterns for a Vue task is
  // exactly the noise that gets a hint ignored. The fallback must not regress it.
  const all = catalog('react-patterns', 'vue-patterns', 'frontend-patterns', 'react-performance');
  const got = intentCandidates('用 vue 写个组件', all);
  assert.equal(got[0], 'vue-patterns', `expected vue first, got ${got.join(',')}`);
  assert.ok(!got.includes('react-patterns'), 'React skills must not appear for a Vue request');
});

test('a React request does not lead with Vue skills', () => {
  const all = catalog('react-patterns', 'vue-patterns', 'frontend-patterns', 'react-performance');
  const got = intentCandidates('用 react 写个组件', all);
  assert.ok(got.includes('react-patterns'));
  assert.ok(!got.includes('vue-patterns'), 'Vue skills must not appear for a React request');
});

test('an unspecified frontend request leads with the generic family', () => {
  const all = catalog('react-patterns', 'vue-patterns', 'frontend-patterns');
  const got = intentCandidates('写个前端组件', all);
  assert.equal(got[0], 'frontend-patterns');
});

test('every matched intent gets at least one candidate before any gets a second', () => {
  // Capping by table order silently dropped 部署 from a request that named it:
  // measured [tdd-workflow, test-coverage, python-testing, react-testing, security-review]
  // for '跑测试 鉴权 部署' — deployment-patterns never appeared. Round-robin fixes that.
  const all = catalog('tdd-workflow', 'test-coverage', 'python-testing', 'react-testing',
    'security-review', 'agent-security-hardening',
    'deployment-patterns', 'docker-patterns');
  const got = intentCandidates('跑测试 鉴权 部署', all);
  assert.ok(got.includes('tdd-workflow'), 'testing intent must be represented');
  assert.ok(got.includes('security-review'), 'security intent must be represented');
  assert.ok(got.includes('deployment-patterns'), 'ops intent must be represented');
  assert.ok(got.length <= 5, `cap must hold, got ${got.length}`);
});

test('a non-security 注入 does not reach the security skills', () => {
  // domains.mjs learned this first: 'ctx.inject' and '点名注入' are NOT attacks.
  const all = catalog('security-review', 'agent-security-hardening');
  assert.deepEqual(intentCandidates('ctx.inject 的注入顺序', all), []);
  assert.deepEqual(intentCandidates('skills: a,b 点名注入', all), []);
});

test('a real attack phrase still reaches the security skills', () => {
  const all = catalog('security-review', 'agent-security-hardening');
  assert.ok(intentCandidates('修复 SQL 注入漏洞', all).includes('security-review'));
  assert.ok(intentCandidates('加固鉴权', all).includes('security-review'));
});

test('the exclusion is per word, not per sentence', () => {
  // A sentence can legitimately mention ctx.inject AND a real attack surface.
  const all = catalog('security-review', 'agent-security-hardening');
  assert.ok(intentCandidates('ctx.inject 之外还要加固鉴权', all).includes('security-review'));
});
