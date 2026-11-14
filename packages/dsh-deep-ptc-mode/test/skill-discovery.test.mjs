// issue-206: the skill loader must be discoverable, and the per-turn hint must
// tell the agent to decide for itself — never paste skill bodies.
//
// Measured on 2026-11-14 (418 logged sessions, deep-ptc composition):
//   - `tools.skill` was callable and returned a 12,610-character body;
//   - the generated SDK section listed only `tool_search`/`tool_describe`;
//   - `tool_search({query:'skill'})` returned nothing while the catalog
//     advertised `skill_get`, a tool that did not exist in that session.
// So the loader worked and the agent could not find it. These tests pin the two
// public behaviours that fix that: a discovery line naming the real loader, and a
// self-check instruction that costs a line rather than a body.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compatibilityPolicy, installToolCompatibility, skillDiscoveryLine } from '../lib/tool-policy.mjs';

test('the discovery line names the loader the agent can actually call', () => {
  const line = skillDiscoveryLine('skill');
  assert.match(line, /tools\.skill\b/);
  // It must be phrased as a self-check, not as a list of skills to load.
  assert.match(line, /自问|ask yourself/i);
});

test('the discovery line never carries a skill body', () => {
  const line = skillDiscoveryLine('skill');
  // A body is thousands of characters; a hint is a line.
  assert.ok(line.length < 400, `discovery line must stay short, got ${line.length}`);
  assert.doesNotMatch(line, /^#\s/m, 'a markdown heading means a body leaked in');
});

test('the discovery line follows the loader name it is given', () => {
  assert.match(skillDiscoveryLine('skill_get'), /tools\.skill_get\b/);
  assert.doesNotMatch(skillDiscoveryLine('skill_get'), /tools\.skill\b(?!_)/);
});

test('the policy tells the agent to search skills before loading them', () => {
  assert.match(compatibilityPolicy, /deep_ptc_tools\(action=skills\)/);
  // And it must say discovery summaries are not instructions — loading is separate.
  assert.match(compatibilityPolicy, /summaries are not skill instructions|discovery summaries/i);
});

test('the discovery line appears only when the loader is really callable', () => {
  // namesOf() is a static source scan: measured on 2026-11-14 it returned ['skill']
  // with getLoader() === undefined, so a directory-only check would name a tool that
  // is not mounted. The gate must read the live registry.
  const harness = (definitions) => {
    const sections = [];
    const ctx = {
      tools: { guard() {}, get() {}, definitions() { return definitions; } },
      systemPrompt: { section: row => sections.push(row), context() {} },
      on() {}, effect() {}, logger: { warn() {} },
    };
    installToolCompatibility(ctx, {
      directory: { namesOf: () => new Set(['skill']) },
      skillProvider: '@deepseek-ai/dsh-tool-skill',
    });
    // The section text is a live provider (this layer now computes it per assembly).
    return () => sections[0].text({ scope: {} });
  };

  // Nothing mounted: the directory still claims 'skill', but it is not callable.
  assert.equal(harness([])(), compatibilityPolicy);

  // The real loader is live: the line appears and names it.
  assert.match(harness([{ name: 'skill' }])(), /tools\.skill\b/);

  // A different live tool does not satisfy the gate.
  assert.equal(harness([{ name: 'read' }])(), compatibilityPolicy);
});

test('the discovery line stays silent when no scope is being assembled', () => {
  // Without a scope there is no registry to probe, so claiming a loader would be a guess.
  const sections = [];
  const ctx = {
    tools: { guard() {}, get() {}, definitions() { return [{ name: 'skill' }]; } },
    systemPrompt: { section: row => sections.push(row), context() {} },
    on() {}, effect() {}, logger: { warn() {} },
  };
  installToolCompatibility(ctx, { directory: { namesOf: () => new Set(['skill']) }, skillProvider: '@deepseek-ai/dsh-tool-skill' });
  assert.equal(sections[0].text({}), compatibilityPolicy);
});
