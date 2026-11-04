// The model-facing prompt section for the credential vault.
//
// The text is a FUNCTION, not a string: `dsh-system-prompt` re-evaluates a
// section's `text` on every assembly, so the credential index below follows the
// vault without a restart and without a second registration.
//
// Two jobs, in this order:
//   1. tell the model what is stored (names + metadata, never values);
//   2. tell it what to do about that — check the vault BEFORE asking the user,
//      use credentials through `DSH_CRED_*` environment variables, and treat
//      `reveal` as an audited escape hatch.

export const HINT_SECTION_NAME = 'dsh-credential-vault:hint'

/** How many entries the index lists before truncating. Bounds the prompt cost. */
export const HINT_INDEX_LIMIT = 50

/**
 * Strip the last chance for prompt injection out of one metadata string.
 *
 * The store validates these on write, but a vault written by an older build (or
 * edited by hand) can still hold a newline, and this text goes into EVERY prompt
 * assembly — so the index never trusts its input: control characters become
 * spaces and the value is capped.
 * @param {unknown} value
 * @param {number} max
 * @returns {string}
 */
function flatten(value, max) {
  if (typeof value !== 'string') return ''
  const flat = value.replace(/[\r\n\t\u0000-\u001f\u007f]+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** Hard cap for one rendered index line, so a wide vault cannot balloon the prompt. */
const INDEX_LINE_MAX = 200

/** One line of the credential index: names and metadata only, never a value. */
function indexLine(entry) {
  const details = [flatten(entry.kind ?? 'other', 32) || 'other']
  const service = flatten(entry.service, 64)
  if (service.length > 0) details.push(service)
  const aliases = Array.isArray(entry.aliases)
    ? entry.aliases.map((alias) => flatten(alias, 64)).filter((alias) => alias.length > 0).slice(0, 8)
    : []
  const suffix = aliases.length > 0 ? `; aliases: ${aliases.join(', ')}` : ''
  const line = `- ${flatten(entry.name, 64) || '(unnamed)'} (${details.join(', ')}${suffix})`
  return line.length > INDEX_LINE_MAX ? `${line.slice(0, INDEX_LINE_MAX)}…` : line
}

/**
 * Render the prompt section for the current vault contents.
 * @param {Array<object>} entries - `store.list()` output
 * @returns {string}
 */
export function buildHintText(entries) {
  const list = Array.isArray(entries) ? entries : []
  const shown = list.slice(0, HINT_INDEX_LIMIT)
  const hidden = list.length - shown.length

  const index =
    list.length === 0
      ? 'The vault is empty right now — no credentials are stored.'
      : [
          'Stored credentials (names and metadata only):',
          ...shown.map(indexLine),
          ...(hidden > 0 ? [`- …and ${hidden} more; call action:"search" to find the rest.`] : []),
        ].join('\n')

  return [
    'Credential vault (dsh-credential-vault): the user keeps passwords, tokens, API keys and database secrets in an encrypted vault you can read through the `credential` tool.',
    '',
    index,
    '',
    'Rules — follow them exactly:',
    '1. BEFORE asking the user for any password, token, API key or connection secret, check this vault: call `credential` with action:"list" or action:"search". If something matches, use it instead of asking. Never ask the user "what is it called" or "where is it stored" while the vault has a matching entry.',
    '2. A name you were given may not be the stored spelling. action:"search" matches by name, alias and service, and action:"get"/"use"/"reveal" accept any close spelling too. If a lookup reports several matches, repeat it with one of the exact names it lists — never guess.',
    '3. To USE a secret, call action:"use" with its name. The result contains no value, only an environment variable name such as DSH_CRED_GITHUB_TOKEN that is injected into every shell command you run until it expires. Reference it as $DSH_CRED_GITHUB_TOKEN.',
    '4. Never echo, print, or run `env`/`printenv` for a DSH_CRED_* variable, and never write its value into a file, URL, git remote, command-line argument, or message. The value must stay in the variable.',
    '5. action:"reveal" returns the plaintext itself and is written to the audit log the user reads in the panel. Use it ONLY when the user explicitly asks to see the value, and then say that the read was audited. If `use` reports that this deployment has no environment-variable injection, stop and tell the user — do not fall back to reveal on your own.',
    '6. Only the user adds or edits credentials, service ids and aliases in the panel. You read them; you never write them.',
  ].join('\n')
}

/**
 * The section definition registered with `ctx.systemPrompt.section()`.
 *
 * The index reads metadata only (never decrypts), and any failure degrades to a
 * one-line fallback: a prompt that throws would break every request in the
 * session, which is far worse than an index that says "use the tool instead".
 */
export function hintSection(store) {
  return {
    name: HINT_SECTION_NAME,
    order: 160,
    text: () => {
      try {
        return buildHintText(store.listMeta())
      } catch {
        return (
          'Credential vault (dsh-credential-vault): the credential index could not be read right now. ' +
          'Use the `credential` tool with action:"list" or action:"search" to see what is stored, and still ' +
          'check it BEFORE asking the user for any password, token or connection secret.'
        )
      }
    },
  }
}
