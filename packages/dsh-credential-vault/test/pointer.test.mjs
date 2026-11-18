// 指针(context 通道)契约:#220 的指针是 deep-ptc 会话里唯一可达的保险库指引,
// issue-224 把它变成「先查库再问人」的硬约束并保证它在任何组合下都注册。
// 两条都是删即红:文案退回到不点名 CLI 登录、或注册丢掉 required: true,各自失败。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HINT_POINTER_NAME, HINT_POINTER_ORDER, HINT_POINTER_TEXT } from '../lib/hint.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_SOURCE = readFileSync(join(HERE, '..', 'index.js'), 'utf8');

test('the pointer tells the model to check the vault BEFORE any interactive CLI login', () => {
  assert.match(HINT_POINTER_TEXT, /Before asking the user for any secret/);
  // 高频翻车场景逐个点名:gh 登录(issue-224 的真实事故)、docker、ssh。
  for (const cli of ['gh auth login', 'docker login', 'ssh-add']) {
    assert.ok(HINT_POINTER_TEXT.includes(cli), 'pointer must name ' + cli);
  }
  assert.match(HINT_POINTER_TEXT, /check the vault first/);
  assert.match(HINT_POINTER_TEXT, /Only when the vault has no match/, 'the interactive login is the fallback, not the default');
});

test('the pointer still teaches the zero-plaintext use path', () => {
  assert.match(HINT_POINTER_TEXT, /DSH_CRED_/);
  assert.match(HINT_POINTER_TEXT, /never via process\.env/);
  assert.match(HINT_POINTER_TEXT, /action:"reveal" returns plaintext/);
});

test('the pointer context registers as required, so subagents see it too', () => {
  // 注册行是源码契约:context({ ... name: HINT_POINTER_NAME ... required: true })。
  const block = INDEX_SOURCE.match(/ctx\.systemPrompt\.context\(\{[\s\S]*?\}\)/);
  assert.ok(block, 'the pointer context registration is present');
  assert.ok(block[0].includes('HINT_POINTER_NAME'), 'the block is the pointer, not another context');
  assert.match(block[0], /required:\s*true/, 'required: true keeps the pointer alive under includeRuntimeContext:false (minimal-style subagent compositions)');
});

test('the credential tool description also points at the vault before interactive logins (issue-224)', () => {
  const desc = INDEX_SOURCE.match(/description:\n\s*'Read credentials[\s\S]*?' +/);
  assert.ok(desc, 'the credential tool description is present');
  for (const cli of ['gh auth login', 'docker login', 'ssh-add']) {
    assert.ok(desc[0].includes(cli), 'tool description must name ' + cli);
  }
  assert.match(desc[0], /action:"list" or action:"search"/);
})

test('the pointer keeps its context-channel identity', () => {
  assert.equal(HINT_POINTER_NAME, 'dsh-credential-vault:pointer');
  assert.equal(HINT_POINTER_ORDER, 20900);
});
