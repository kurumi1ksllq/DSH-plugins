/**
 * Secret and host-specific redaction for anything that leaves this machine.
 *
 * Two different leaks, both fatal in different ways:
 *
 *   Secrets  A literal API key pushed to a public repository is compromised the
 *            moment it is pushed. It cannot be un-pushed. Redaction therefore
 *            runs on every outbound document, not only on the ones that "look"
 *            sensitive.
 *   Host facts  `C:\Program Files\nodejs\node.exe` is not secret, but it is
 *            meaningless on Linux and actively harmful if copied: the target
 *            tries to spawn it, fails, and reports a broken capability that is
 *            really just a path from someone else's machine.
 *
 * The rule is uniform: an outbound string that looks like a secret becomes a
 * placeholder, and an absolute path is replaced by a portable form.
 */

/** Placeholder left where a secret was removed. */
export const REDACTED = '<REDACTED>'

/**
 * A PEM private-key block, header through matching footer, redacted whole.
 *
 * The base64 body is the secret; scrubbing one line of a multi-line block used
 * to publish a fully usable key that merely looked marked. `[\s\S]*?` stops at
 * the first footer so two keys in one document stay two matches, and Keychain /
 * OpenSSH / PKCS8 spellings all end in `PRIVATE KEY`.
 */
const PEM_PRIVATE_KEY = /-----BEGIN[A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z0-9 ]*PRIVATE KEY-----/g

/**
 * An `Authorization: <scheme> <credential>` line, whatever the surrounding
 * header quoting looks like.
 *
 * Bearer is matched with any token material (a JWT has dots, a base64 blob has
 * padding). Basic is matched when its base64 material is long enough to carry
 * real `user:password`: the matcher counts instead of decoding, because the
 * base64 of even a one-character pair is 4 characters while `Basic realm`
 * style prose sits below the threshold, and no client actually sends fewer than
 * 18 base64 characters of credentials.
 */
const AUTH_SCHEME_LINE = /\b(?:authorization\s*[:=]\s*["']?\s*)?(?:bearer\s*[A-Za-z0-9._~+/-]{8,}={0,2}|basic\s*[A-Za-z0-9+/]{18,}={0,2})/gi

/**
 * Known credential shapes. Ordered most-specific first so a `ctx7sk-` key is
 * not also matched by the generic long-token rule.
 */
const SECRET_PATTERNS = [
  // Multi-character shapes first: a later single-token rule firing inside a PEM
  // body or a bearer line would leave the rest half-intact.
  PEM_PRIVATE_KEY,
  AUTH_SCHEME_LINE,
  // context7 service keys
  /ctx7sk-[A-Za-z0-9-]{10,}/g,
  // GitHub tokens
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  // OpenAI / DeepSeek style keys
  /sk-[A-Za-z0-9-]{16,}/g,
  // AWS access key ids
  /AKIA[0-9A-Z]{16}/g,
  // Bearer tokens in a literal. Case-insensitive: a hand-written lowercase
  // `bearer` is the same credential.
  /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi,
  // Google API keys
  /AIza[A-Za-z0-9_-]{30,}/g,
  // A bare JWT — three base64url segments, the first being a JSON header. Two
  // long segments are required so `eyWords.eyMore` style prose stays intact.
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{4,})?/g,
  // GitLab personal access tokens
  /glpat-[A-Za-z0-9_-]{20,}/g,
  // Slack tokens
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
]

/** Object keys whose value is always a credential, whatever it looks like. */
const SECRET_KEYS = new Set([
  'apikey',
  'api_key',
  'api-key',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'secret',
  'secretkey',
  'secret_key',
  'clientsecret',
  'client_secret',
  'privatekey',
  'private_key',
  'password',
  'passwd',
  'authorization',
  'auth',
  'credential',
  'credentials',
  // Compound spellings seen on real MCP/plugin configs: the concatenated form
  // of an obvious secret name with a trailing noun (`clientSecretValue`,
  // `refreshTokenValue`, `secretKeyValue`) is still the secret itself.
  'clientsecretvalue',
  'clientsecretkey',
  'refreshtokenvalue',
  'accesstokenvalue',
  'apikeyvalue',
  'authtokenvalue',
  'secretvalue',
  'tokenvalue',
  // …as is an explicitly named key, passphrase or session credential.
  'secretkeyvalue',
  'privatekeypem',
  'privatekeyvalue',
  'privatekeydata',
  'privatekeycontent',
  'accesskey',
  'access_key',
  'accesskeyid',
  'secretaccesskey',
  'awssecretaccesskey',
  'aws_access_key_id',
  'aws_secret_access_key',
  'authtoken',
  'auth_token',
  'apitoken',
  'api_token',
  'gbtoken',
  'ghtoken',
  'githubtoken',
  'github_token',
  'oauthtoken',
  'oauth_token',
  'idtoken',
  'id_token',
  'sastoken',
  'sas_token',
  'bearer',
  'bearertoken',
  'bearer_token',
  'xapikey',
  'jwt',
  'jwttoken',
  'signingkey',
  'signing_key',
  'privatekeypassphrase',
  'passphrase',
  'mnemonic',
  'seedphrase',
  'cookie',
  'setcookie',
  'connectionstring',
  'dbpassword',
  'db_password',
  'webhooksecret',
  'encryptionkey',
  'encryption_key',
  'masterkey',
  'master_key',
  'sessiontoken',
  'session_token',
])

/** A key whose name marks it as an *indirection* to a secret, not the secret. */
const ENV_KEY_HINTS = /(?:apikeyenv|api_key_env|tokenenv|envkey)$/i

/**
 * The same indirection rule, generalised to the names added for #12.
 *
 * `privateKeyPath` names where the key lives and `privateKeyFile` which file
 * holds it; freezing either would break a working config and teach nothing.
 * `privateKeyPem` / `privateKeyValue` carry the key itself and stay secrets.
 */
const INDIRECTION_SUFFIX = /(?:env|environ|environment)$|(?:env|envvar|envname|envkey|path|file|filename|filepath|name)$/i

/**
 * Key names that are never compared with SECRET_KEYS.
 *
 * The `auth` family is why this list exists: `baseURL` → `baseurl` and
 * `author` → `author` both end in `auth` once the lookup strips a trailing
 * noun, so a bare `auth` in the set would redact every base URL in a document.
 * Only the spellings that really hold a token are listed explicitly instead.
 * Likewise an MCP `session` id is routing state, and `keys` is a list of names.
 */
const NOT_SECRET_NAMES = new Set(['auth', 'session', 'keys'])

/**
 * A key that names a whole environment block. MCP server configs put their
 * credentials under `env`, and the key names inside (`GITHUB_TOKEN`,
 * `PRIVATE_KEY`) are arbitrary — so every value inside an env-like object is
 * treated as a credential unless it is clearly not one.
 */
const ENV_BLOCK_KEY = /^(?:env|environment)(?:[-_]?(?:vars?|variables?|values?|entries))?$/i

/** Values that never look like a credential: URLs, flags, short or plain words. */
const SAFE_ENV_VALUE = /^(?:https?:\/\/\S*|\$(?:\{[^}]*\}|[A-Za-z_][A-Za-z0-9_]*)(?:[\/][^\s]*)?|\d+(?:\.\d+)*|true|false|yes|no|on|off|null|none|[a-z][a-z0-9_-]{0,15})$/i

/**
 * Something that looks like a real credential.
 *
 * Long opaque material and PEM headers are the obvious case. The rest exists
 * because a *short* secret (under 20 characters) used to slip through: a value
 * counts as credential-like when
 *   - it is built like a password — punctuation, or `user:pass` with a colon; or
 *   - it mixes letters and digits (`s3cr3t`, `p4ssw0rd`); or
 *   - it is a bare hex/base64 digest long enough to be key material.
 * Plain words, plain numbers, booleans, URLs and shell interpolations are not
 * credential-like, so `DEBUG=true`, `PORT=8080`, `CMD=node` stay readable.
 *
 * The mixed-case rule is deliberately absent: `production` is not a secret and
 * `PRODUCTION` is very often an ordinary mode switch.
 */
const SECRET_LIKE_VALUE = /^(?:[A-Za-z0-9._~+/=:,!$%^*(){}[\]<>?|-]{20,}|-----BEGIN [A-Z ]+-----$|(?=[A-Za-z0-9+/=]*[0-9+/=])[A-Za-z0-9+/=]{12,}$|.*\S:[^\s]*|(?=.*\d)(?=.*[a-z]).*|.*[!,@#%^&*()>|~`].*[!,@#%^&*()>|~`].*)$/

/** Replace every recognised credential shape inside a string. */
export function redactString(text) {
  if (typeof text !== 'string' || text.length === 0) return text
  let out = text
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTED)
  }
  return out
}

/**
 * Normalised key names worth testing: the name itself, then the name minus one
 * trailing word (`clientSecretValue` → `clientsecret`, `session_token_v2` →
 * `session_token`).
 *
 * The exact-match rule alone missed every `<secretName><Noun>` spelling, so
 * the lookup now tolerates one suffix word that names the *role* of the value
 * rather than changing what it is. Two levels are not followed: `value` of
 * `value` is not a thing, and the deeper the strip the likelier a false
 * positive on an ordinary field.
 */
function keyNameCandidates(lower) {
  const candidates = [lower]
  const trimmed = lower.replace(/[-_]?[a-z]{2,12}$/, (suffix) => (suffix === lower ? suffix : ''))
  if (trimmed.length > 0 && trimmed !== lower) candidates.push(trimmed.replace(/[-_]$/, ''))
  return candidates
}

/** True when a key name says "this value is a credential". */
export function isSecretKey(key) {
  if (typeof key !== 'string') return false
  const lower = key.toLowerCase().replace(/[^a-z0-9_-]/g, '').replace(/_/g, '-')
  if (ENV_KEY_HINTS.test(lower) || INDIRECTION_SUFFIX.test(lower)) return false
  for (const candidate of keyNameCandidates(lower)) {
    // Underscore and hyphen spellings of the same name are one name:
    // `secret_key` and `secret-key` never mean different things.
    const forms = [candidate, candidate.replace(/-/g, '_'), candidate.replace(/[-_]/g, '')]
    for (const form of forms) {
      if (NOT_SECRET_NAMES.has(form)) return false
      if (SECRET_KEYS.has(form)) return true
    }
  }
  return false
}

/**
 * Deep-redact a value.
 *
 * Walks objects and arrays, replacing credential-keyed values wholesale and
 * scrubbing credential shapes out of every other string. Returns a new
 * structure; the input is never mutated.
 *
 * @param {string} [key] - the object key this value sits under, so an
 *   `env`-style block can be recognized and scanned more aggressively.
 * @param {boolean} [inEnvBlock] - set while walking the inside of such a block,
 *   so nested objects stay under the same rule.
 */
export function redactValue(value, depth = 0, key, inEnvBlock) {
  if (depth > 12) return value
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1))
  if (value !== null && typeof value === 'object') {
    const envBlock = inEnvBlock === true || ENV_BLOCK_KEY.test(key ?? '')
    const out = {}
    for (const [entryKey, item] of Object.entries(value)) {
      if (isSecretKey(entryKey) && item !== null && item !== undefined && item !== '') {
        out[entryKey] = REDACTED
        continue
      }
      // Inside an env block the key names are arbitrary, so credential-shaped
      // string values are redacted on sight — a `GH_TOKEN` spelled any way
      // still holds a token.
      if (envBlock && typeof item === 'string' && item.length > 0
        && SECRET_LIKE_VALUE.test(item) && !SAFE_ENV_VALUE.test(item)) {
        out[entryKey] = REDACTED
        continue
      }
      // An env block propagates into its nested objects: a credential nested one
      // level deeper is not less of a credential.
      out[entryKey] = redactValue(item, depth + 1, entryKey, envBlock)
    }
    return out
  }
  return value
}

/**
 * Absolute-path shapes worth replacing with a portable placeholder.
 *
 * `%LOCAL_ONLY%` is not a real path on purpose: a target that blindly substitutes
 * it fails loudly instead of silently pointing at the wrong file.
 *
 * Windows paths are matched in two passes because they can contain spaces
 * (`C:\Program Files\nodejs\node.exe`): a quoted path is consumed whole, and
 * only then does the space-terminated rule apply to bare occurrences.
 */
const QUOTED_WIN_PATH = /(['"`])([A-Za-z]:[\\/][^'"`\n]*)(['"`])/g

/** A string that is entirely one absolute path, spaces and all. */
const WHOLE_WIN_PATH = /^[A-Za-z]:[\\/][^"'`\n,;|<>]*$/
const WHOLE_POSIX_PATH = /^(?![a-z][a-z0-9+.-]*:\/\/)\/[^"'`\n,;|<>]*$/

const ABSOLUTE_PATHS = [
  // Windows drive letters without spaces: C:\..., C:/...
  { pattern: /(?:[A-Za-z]:[\\/][^"'`\s,;|<>]*)/g, kind: 'win-abs' },
  // POSIX absolute paths that are clearly host-local (not URLs, which never
  // reach this branch because the scheme is shielded first).
  { pattern: /(?:^|[\s"'`=(,])(\/[A-Za-z0-9_.-]+[^"'`\s,;|<>]*)/g, kind: 'posix-abs' },
]

/**
 * Park URLs on sentinels so absolute-path rules cannot reach inside them.
 *
 * Shared by both the rewriter and the scanner: if they disagreed, the panel
 * would report paths that redaction then leaves alone (or vice versa), and the
 * user would be told a lie about their own document.
 */
function shieldUrls(text) {
  const urls = []
  const masked = text.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>]*/gi, (match) => {
    urls.push(match)
    return `\u0000URL${urls.length - 1}\u0000`
  })
  return { masked, urls }
}

function restoreUrls(text, urls) {
  return text.replace(/\u0000URL(\d+)\u0000/g, (_, index) => urls[Number(index)] ?? '')
}

/**
 * Replace host-absolute paths with `%LOCAL_ONLY%`.
 *
 * URLs are protected first so `https://host/path` keeps its path.
 */
export function redactPaths(text) {
  if (typeof text !== 'string' || text.length === 0) return text

  // URLs are parked on sentinels first: WHOLE_WIN_PATH allows spaces, so
  // `C:\x https://y` would otherwise be swallowed whole by the whole-string
  // branch and the URL would vanish with it.
  const { masked, urls } = shieldUrls(text)

  // Only when no URL was shielded can the value be treated as one whole path;
  // otherwise the sentinel would ride along inside the match.
  if (urls.length === 0) {
    const whole = text.trim()
    if (WHOLE_WIN_PATH.test(whole) || WHOLE_POSIX_PATH.test(whole)) {
      return text.replace(whole, '%LOCAL_ONLY%')
    }
  }

  let out = masked
  // Quoted Windows paths next: they may contain spaces, which the bare rule
  // would treat as a terminator.
  out = out.replace(QUOTED_WIN_PATH, (match, open, _path, close) => `${open}%LOCAL_ONLY%${close}`)
  out = out.replace(ABSOLUTE_PATHS[0].pattern, '%LOCAL_ONLY%')
  out = out.replace(ABSOLUTE_PATHS[1].pattern, (match, path) => {
    // Keep whatever separator preceded the path (space, quote, `=`, ...).
    const prefix = match.slice(0, match.length - path.length)
    return `${prefix}%LOCAL_ONLY%`
  })
  return restoreUrls(out, urls)
}

/** Redact secrets, then paths, across a whole structure. */
export function redactForTransport(value) {
  return redactPathsDeep(redactValue(value))
}

function redactPathsDeep(value, depth = 0) {
  if (depth > 12) return value
  if (typeof value === 'string') return redactPaths(value)
  if (Array.isArray(value)) return value.map((item) => redactPathsDeep(item, depth + 1))
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      out[key] = redactPathsDeep(item, depth + 1)
    }
    return out
  }
  return value
}

/**
 * Report what redaction would remove, without producing the redacted document.
 *
 * The panel shows this before a publish: "3 secrets will be stripped" is a
 * decision the user gets to make, not something to discover afterwards.
 *
 * @param {true} [inEnvBlock] - private recursion flag: the current object is an
 *   `env`-style block, so the env-block rule applies to its string values.
 */
export function scanForSecrets(value, path = '', found = [], inEnvBlock) {
  if (typeof value === 'string') {
    const hit = firstSecretMatch(value)
    if (hit !== null) {
      found.push({ path, kind: 'literal', preview: maskPreview(hit) })
      return found
    }
    // A short secret caught only by the env-block rule still counts, or the
    // panel would promise "nothing to redact" over a document that changes.
    if (inEnvBlock === true && value.length > 0
      && SECRET_LIKE_VALUE.test(value) && !SAFE_ENV_VALUE.test(value)) {
      found.push({ path, kind: 'keyed', preview: maskPreview(value) })
    }
    return found
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForSecrets(item, `${path}[${index}]`, found))
    return found
  }
  if (value !== null && typeof value === 'object') {
    for (const [entryKey, item] of Object.entries(value)) {
      const next = path.length === 0 ? entryKey : `${path}.${entryKey}`
      if (isSecretKey(entryKey) && item !== null && item !== undefined && item !== '') {
        found.push({ path: next, kind: 'keyed', preview: maskPreview(String(item)) })
        continue
      }
      const childEnv = ENV_BLOCK_KEY.test(entryKey)
      scanForSecrets(item, next, found, childEnv ? true : undefined)
    }
  }
  return found
}

/** The first credential shape in a string, or null. Shared with the scanner. */
function firstSecretMatch(value) {
  for (const pattern of SECRET_PATTERNS) {
    // Fresh lastIndex: the patterns are /g and are shared across calls.
    pattern.lastIndex = 0
    const match = pattern.exec(value)
    if (match !== null) return match[0]
  }
  return null
}

/** Show enough of a secret to recognise it, never enough to use it. */
function maskPreview(text) {
  const value = String(text)
  if (value.length <= 6) return REDACTED
  return `${value.slice(0, 4)}…${value.slice(-2)}`
}

/** Count absolute paths that would be replaced. */
export function scanForPaths(value, path = '', found = []) {
  if (typeof value === 'string') {
    // Same URL shielding as redactPaths, so the count matches what redaction
    // would actually change.
    const { masked } = shieldUrls(value)
    const whole = masked.trim()
    if (WHOLE_WIN_PATH.test(whole) || WHOLE_POSIX_PATH.test(whole)) {
      found.push({ path })
      return found
    }
    QUOTED_WIN_PATH.lastIndex = 0
    if (QUOTED_WIN_PATH.test(masked)) {
      found.push({ path })
      return found
    }
    for (const { pattern } of ABSOLUTE_PATHS) {
      pattern.lastIndex = 0
      if (pattern.test(masked)) {
        found.push({ path })
        break
      }
    }
    return found
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForPaths(item, `${path}[${index}]`, found))
    return found
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const next = path.length === 0 ? key : `${path}.${key}`
      scanForPaths(item, next, found)
    }
  }
  return found
}
