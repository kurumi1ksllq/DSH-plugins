import test from 'node:test';
import assert from 'node:assert/strict';
import { COPY, copy } from '../lib/governor-copy.mjs';
import { EXEC_DISCIPLINE_TEXT, execDisciplineText } from '../lib/governor-anchor.mjs';

// #144:纪律文案单源契约。zh 与 en 都走 governor-copy.mjs 的 discipline0..9 字典,
// EXEC_DISCIPLINE_TEXT 由 zh 字典派生;任何一侧单独改动都会让本测试变红。

// ⓪–⑨ 十个序号标记(③拆 3a/3b 两条、④⑤合入 discipline4,但标记必须齐全且有序)
const MARKERS = ['⓪', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
const DISCIPLINE_KEYS = ['discipline0', 'discipline1', 'discipline2', 'discipline3a', 'discipline3b',
  'discipline4', 'discipline6', 'discipline7', 'discipline8', 'discipline9'];

// 拼装键集与 anchor 内部实现的一致性由 test 2(zh=字典派生)间接守护;
// 本地副本仅用于构造期望值。

function joinDiscipline(locale) {
  const t = copy(locale);
  return DISCIPLINE_KEYS.map((k) => {
    assert.equal(typeof t[k], 'function', `${locale} 缺 discipline 键: ${k}`);
    return t[k]();
  }).join('');
}

test('zh 纪律全文与 EXEC_DISCIPLINE_TEXT 基准常量逐字一致', () => {
  assert.equal(execDisciplineText('zh'), EXEC_DISCIPLINE_TEXT);
});

test('zh 纪律全文由 COPY 字典派生(单源,不再有独立硬编码副本)', () => {
  assert.equal(execDisciplineText('zh'), joinDiscipline('zh'));
});

test('zh/en 纪律块同构:⓪-⑨ 标记齐全且顺序一致', () => {
  for (const locale of ['zh', 'en']) {
    const text = execDisciplineText(locale);
    let at = -1;
    for (const m of MARKERS) {
      const i = text.indexOf(m);
      assert.ok(i > at, `${locale} 缺少标记或顺序错乱: ${m}`);
      at = i;
    }
  }
});

test('zh 字典 discipline 键与常量拼装同源(缺键即红)', () => {
  for (const k of DISCIPLINE_KEYS) {
    assert.equal(typeof COPY.zh[k], 'function', `COPY.zh 缺 ${k}`);
    assert.equal(typeof COPY.en[k], 'function', `COPY.en 缺 ${k}`);
  }
});

test('zh/en 每条 discipline 条目非空且条目数相等(空串或条数漂移即红,#146 轴1)', () => {
  for (const locale of ['zh', 'en']) {
    const t = copy(locale);
    for (const k of DISCIPLINE_KEYS) assert.ok(t[k]().length > 0, `${locale}.${k} 为空串`);
  }
});

test('COPY 字典 discipline 键集合与拼装键集完全一致(多键漏拼也红,#146 轴1)', () => {
  for (const locale of ['zh', 'en']) {
    const actual = Object.keys(COPY[locale]).filter((k) => k.startsWith('discipline')).sort();
    assert.deepEqual(actual, [...DISCIPLINE_KEYS].sort(), `${locale} discipline 键集合漂移`);
  }
});
