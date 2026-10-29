// Pure decision logic for dsh-mcp-workspace-gate.
// No cordis, no DSH imports: everything here is testable with plain node:test.

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

/** Default declaration file, relative to a workspace root. */
export const DEFAULT_DECLARATION_FILE = '.dsh/mcp.json';

const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/;
const TRANSPORTS = new Set(['stdio', 'streamable-http']);

/**
 * Normalize a directory path for comparison: absolute, symlink-resolved when it
 * exists, trailing separators stripped. Windows drive letters are upper-cased.
 * Never throws for a well-formed string; a non-existent directory keeps its
 * resolved form so callers can still compare it.
 */
export function normalizeDir(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new TypeError('normalizeDir: path must be a non-empty string');
  }
  let abs = path.resolve(input);
  try {
    abs = realpathSync.native(abs);
  } catch {
    // Keep the resolved path: the directory may not exist yet, and the gate
    // must not fail a session because of that.
  }
  abs = path.resolve(abs).replace(/[\\/]+$/, '');
  if (abs === '') abs = path.parse(path.resolve(input)).root;
  if (process.platform === 'win32') {
    abs = abs.replace(/^([a-zA-Z]):/, (_, drive) => `${drive.toUpperCase()}:`);
  }
  return abs;
}

/** Comparison key: Windows is case-insensitive, POSIX is not. */
export function pathKey(dir) {
  const normalized = normalizeDir(dir);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Walk up from `cwd` looking for the declaration file.
 * @returns {{ root: string, file: string } | undefined}
 */
export function findDeclaration(cwd, declarationFile = DEFAULT_DECLARATION_FILE, searchParents = true) {
  let dir = normalizeDir(cwd);
  const relative = declarationFile.replace(/^[\\/]+/, '');
  const root = path.parse(dir).root;

  for (;;) {
    const candidate = path.join(dir, relative);
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return { root: dir, file: candidate };
      }
    } catch {
      // Unreadable candidate: treat as absent and keep walking.
    }
    if (!searchParents || dir === root) return undefined;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Validate one declared server entry against the mcp-client config surface.
 * @returns {{ ok: true, config: object } | { ok: false, error: string }}
 */
export function normalizeServer(name, entry, options = {}) {
  const { serverNameSuffix = '' } = options;
  if (!SERVER_NAME.test(name)) {
    return { ok: false, error: `server name "${name}" must match [A-Za-z0-9_-]{1,32}` };
  }
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return { ok: false, error: `server "${name}" must be an object` };
  }
  const transport = entry.transport;
  if (!TRANSPORTS.has(transport)) {
    return { ok: false, error: `server "${name}": transport must be "stdio" or "streamable-http"` };
  }
  const serverName = `${name}${serverNameSuffix}`;
  if (!SERVER_NAME.test(serverName)) {
    return { ok: false, error: `server "${name}": "${serverName}" must match [A-Za-z0-9_-]{1,32}` };
  }

  if (transport === 'stdio') {
    if (typeof entry.command !== 'string' || entry.command.trim() === '') {
      return { ok: false, error: `server "${name}": stdio requires a non-empty "command"` };
    }
    const config = {
      serverName,
      transport: 'stdio',
      command: entry.command,
      args: Array.isArray(entry.args) ? entry.args.map(String) : [],
      env: entry.env && typeof entry.env === 'object' ? entry.env : {},
      cwd: typeof entry.cwd === 'string' ? entry.cwd : '',
      // Gate policy: a broken MCP server must never block the session.
      failOnStartupError: false,
    };
    return { ok: true, config };
  }

  if (typeof entry.url !== 'string' || entry.url.trim() === '') {
    return { ok: false, error: `server "${name}": streamable-http requires a non-empty "url"` };
  }
  const config = {
    serverName,
    transport: 'streamable-http',
    url: entry.url,
    headers: entry.headers && typeof entry.headers === 'object' ? entry.headers : {},
    failOnStartupError: false,
  };
  return { ok: true, config };
}

/**
 * Parse declaration text.
 * @returns {{ ok: true, servers: object } | { ok: false, error: string }}
 */
export function parseDeclaration(text, options = {}) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `invalid JSON: ${error.message}` };
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, error: 'declaration root must be an object' };
  }
  const servers = doc.servers;
  if (servers === null || typeof servers !== 'object' || Array.isArray(servers)) {
    return { ok: false, error: 'declaration must contain a "servers" object' };
  }
  const allow = Array.isArray(options.allowServerNames) ? options.allowServerNames : [];
  const picked = {};
  for (const [name, entry] of Object.entries(servers)) {
    if (allow.length > 0 && !allow.includes(name)) continue;
    const result = normalizeServer(name, entry, options);
    if (!result.ok) return { ok: false, error: result.error };
    picked[name] = result.config;
  }
  return { ok: true, servers: picked };
}

/**
 * Decide whether an agent whose session cwd is `cwd` may mount MCP servers.
 * @returns {{ mount: boolean, root?: string, file?: string, servers: object, reason: string }}
 */
export function planMount(cwd, options = {}) {
  const {
    declarationFile = DEFAULT_DECLARATION_FILE,
    searchParents = true,
    allowServerNames = [],
    serverNameSuffix = '',
    enabled = true,
    readFile = (file) => readFileSync(file, 'utf8'),
  } = options;

  const empty = { mount: false, servers: {}, reason: '' };

  if (!enabled) return { ...empty, reason: 'gate disabled by config' };
  if (typeof cwd !== 'string' || cwd.trim() === '') {
    return { ...empty, reason: 'session has no working directory' };
  }

  const found = findDeclaration(cwd, declarationFile, searchParents);
  if (found === undefined) {
    return { ...empty, reason: `no ${declarationFile} found from ${cwd}` };
  }

  let text;
  try {
    text = readFile(found.file);
  } catch (error) {
    return { ...empty, root: found.root, file: found.file, reason: `unreadable declaration: ${error.message}` };
  }

  const parsed = parseDeclaration(text, { allowServerNames, serverNameSuffix });
  if (!parsed.ok) {
    return { ...empty, root: found.root, file: found.file, reason: parsed.error };
  }
  const names = Object.keys(parsed.servers);
  if (names.length === 0) {
    return { ...empty, root: found.root, file: found.file, reason: 'declaration lists no mountable servers' };
  }
  return {
    mount: true,
    root: found.root,
    file: found.file,
    servers: parsed.servers,
    reason: `declared in ${found.file}`,
  };
}
