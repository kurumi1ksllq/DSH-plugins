// Copy for the fallback surface, zh/en same-structure dictionaries.
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

const COPY = {
  zh: {
    heading: '## 技能(本会话没有官方 skill 工具)',
    bullets: [
      '- 列出可用技能:' + tick(LOADER) + '(不带参数),每个技能一行。',
      '- 加载正文:' + tick(LOADER + ' <name>') + ',拿到 ' + tick('<skill_content>') + ' 后按它执行。',
      '- 委派给别人时,在任务里单独起一行写 ' + tick('skills: a, b') + '(最多 6 个),对方会直接拿到正文。',
      '- 清单只是索引,正文才是指令;没有命中就直接做,不要硬套。',
    ],
    footer: '这条提示只在本会话没有官方 skill 工具时出现;有官方工具时不要用 ' + tick(LOADER) + '。',
  },
  en: {
    heading: '## Skills (this session has no official skill tool)',
    bullets: [
      '- List what is available: ' + tick(LOADER) + ' with no argument, one skill per line.',
      '- Load a body: ' + tick(LOADER + ' <name>') + ', then follow the ' + tick('<skill_content>') + ' block it returns.',
      '- When you delegate, put ' + tick('skills: a, b') + ' on its own line in the task (at most 6); the child receives those bodies directly.',
      '- The listing is an index, the body is the instruction; when nothing matches, just do the work.',
    ],
    footer: 'This hint exists only because no official skill tool is mounted; when one is, prefer it over ' + tick(LOADER) + '.',
  },
}

/**
 * Constant hint for agents with no official skill tool.
 * @param locale - 'zh' (default) or 'en'; unknown locales fall back to zh.
 * @returns the hint text.
 */
export function hintText(locale = 'zh') {
  const copy = COPY[locale] ?? COPY.zh
  return [copy.heading, '', ...copy.bullets, '', copy.footer].join('\n')
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
