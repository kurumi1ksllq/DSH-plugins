// issue-206: a query with no lexical match must still offer catalog-verified
// guesses, and must never invent a name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../index.js';
import { setHostApi } from '../lib/host-api.mjs';
import { LOADER } from '../lib/catalog-hint.mjs';

function skillRow(name, content = 'body') {
  return { name, description: name + ' description.', provider: 'filesystem', content, invocation: { modelInvocable: true } };
}

function harness(rows) {
  setHostApi({
    renderSkillContent: (skill) => '<skill_content name="' + skill.name + '">' + skill.content + '</skill_content>',
    isModelInvocable: (skill) => skill.invocation.modelInvocable === true,
    createUserMessage: ({ content, source }) => ({ role: 'user', content, source }),
  });
  const registered = [];
  const scope = {
    effect(factory) { return factory() },
    logger: { warn() {} },
    systemPrompt: { section() { return () => {} }, context() { return () => {} } },
    on() { return () => {} },
    skills: {
      snapshot: () => Promise.resolve({ skills: rows, complete: true }),
      get: (name) => Promise.resolve(rows.find((row) => row.name === name)),
    },
    workingDirectory: { ensure: () => Promise.resolve('/work') },
    tools: {
      get() { return undefined },
      register(definition) { registered.push(definition); return () => {} },
    },
  };
  apply({ inject(_deps, callback) { callback(scope) } });
  const loader = registered.find((definition) => definition.name === LOADER);
  return (args) => loader.execute(args, { agent: undefined, signal: undefined });
}

test('an unmatched Chinese query offers catalog-verified guesses', async () => {
  const run = harness([skillRow('tdd-workflow'), skillRow('test-coverage'), skillRow('unrelated')]);
  const out = await run({ query: '跑一下测试看看' });
  assert.match(out.text, /tdd-workflow/);
  assert.match(out.text, /test-coverage/);
  assert.doesNotMatch(out.text, /unrelated/);
});

test('guesses never name a skill the catalog does not have', async () => {
  // The intent table also names python-testing/react-testing; this install has neither.
  const run = harness([skillRow('tdd-workflow')]);
  const out = await run({ query: '写个单元测试' });
  assert.match(out.text, /tdd-workflow/);
  assert.doesNotMatch(out.text, /python-testing|react-testing/);
});

test('a genuinely unmatched query still says so', async () => {
  const run = harness([skillRow('tdd-workflow')]);
  const out = await run({ query: '今天天气不错' });
  assert.match(out.text, /没有匹配的技能/);
});
