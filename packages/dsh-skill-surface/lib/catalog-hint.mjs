// Copy for the fallback surface.
//
// Deliberately tiny and constant: it is a systemPrompt context evaluated on
// every assembly, so stable text keeps the prompt cache warm — and the whole
// point is that it disappears for agents that already have the official loader.

/** Name of the loader this plugin adds when the official one is absent. */
export const LOADER = 'skill_get'

const TICK = String.fromCharCode(96)

/** Wrap text in one backtick pair without hard-coding the delimiter in source. */
function tick(text) {
  return TICK + text + TICK
}

/**
 * Constant hint for agents with no official skill tool.
 * @returns the hint text.
 */
export function hintText() {
  return [
    '## 技能(本会话没有官方 skill 工具)',
    '',
    '- 列出可用技能:' + tick(LOADER) + '(不带参数),每个技能一行。',
    '- 加载正文:' + tick(LOADER + ' <name>') + ',拿到 ' + tick('<skill_content>') + ' 后按它执行。',
    '- 委派给别人时,在任务里单独起一行写 ' + tick('skills: a, b') + '(最多 6 个),对方会直接拿到正文。',
    '- 清单只是索引,正文才是指令;没有命中就直接做,不要硬套。',
  ].join('\n')
}

/**
 * Compact index line for one skill: name plus its first sentence.
 * @param skill - a skill summary from the registry.
 * @param maxDescription - description cap in characters.
 * @returns one bullet line.
 */
export function indexLine(skill, maxDescription = 120) {
  const flat = String(skill.description ?? '').replace(/\s+/gu, ' ').trim()
  const firstSentence = flat.split(/(?<=[.!?])\s/u)[0] ?? flat
  const text = firstSentence.length <= maxDescription
    ? firstSentence
    : firstSentence.slice(0, maxDescription - 1).trimEnd() + '…'
  return '- ' + tick(skill.name) + ': ' + text
}
