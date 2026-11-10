// Host module access for the two official helpers this plugin borrows.
//
// A linked install does not necessarily route `@deepseek-ai/*` to a node_modules
// copy, so resolution walks several anchors before giving up. An unresolved
// host is NOT fatal: the caller degrades to "no injection" rather than throwing
// inside a step listener, because a throw here would end the child's turn with
// no model reply.

import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let installed
let pending

function requireFrom(anchorUrl, specifier) {
  try {
    return createRequire(anchorUrl).resolve(specifier)
  } catch {
    return undefined
  }
}

function viaAnchor(anchorSpecifier, specifier) {
  try {
    return requireFrom(import.meta.resolve(anchorSpecifier), specifier)
  } catch {
    return undefined
  }
}

/**
 * Resolve a host module the way the installed runtime would.
 * @param specifier - bare module name owned by the Harness.
 * @returns a file URL, or undefined when no anchor provides the module.
 */
export function resolveHost(specifier) {
  try {
    return import.meta.resolve(specifier)
  } catch {
    // Not routed for this plugin; try the runtime's own graph below.
  }
  const own = requireFrom(import.meta.url, specifier)
  if (own !== undefined) return pathToFileURL(own).href
  for (const anchor of ['@deepseek-ai/dsh/package.json', '@deepseek-ai/dsh-web-app/package.json']) {
    const found = viaAnchor(anchor, specifier)
    if (found !== undefined) return pathToFileURL(found).href
  }
  const profileDir = process.env.DSH_PROFILE_DIR
  if (profileDir !== undefined && profileDir !== '') {
    const found = requireFrom(pathToFileURL(join(profileDir, 'package.json')).href, specifier)
    if (found !== undefined) return pathToFileURL(found).href
  }
  return undefined
}

/**
 * Replace the host API (tests, or an embedding that already holds it).
 * Passing undefined clears the override and re-arms real resolution.
 * @param api - the official helpers to use instead of the installed Harness.
 */
export function setHostApi(api) {
  installed = api
  pending = undefined
}

async function load() {
  const url = resolveHost('@deepseek-ai/dsh-skill')
  const llm = resolveHost('@deepseek-ai/dsh-llm')
  if (url === undefined || llm === undefined) {
    throw new Error('dsh-skill-surface: the installed Harness provides no dsh-skill/dsh-llm module')
  }
  const [skill, message] = await Promise.all([import(url), import(llm)])
  for (const name of ['renderSkillContent', 'isModelInvocable']) {
    if (typeof skill[name] !== 'function') throw new Error(`dsh-skill-surface: dsh-skill lacks ` + name)
  }
  if (typeof message.createUserMessage !== 'function') {
    throw new Error('dsh-skill-surface: dsh-llm lacks createUserMessage')
  }
  installed = {
    renderSkillContent: skill.renderSkillContent,
    isModelInvocable: skill.isModelInvocable,
    createUserMessage: message.createUserMessage,
  }
  return installed
}

/**
 * Load the official helpers this plugin borrows.
 *
 * BORROWS, does not reimplement: the `<skill_content>` frame, the invocation
 * policy and the durable user message are official single sources.
 * @returns renderSkillContent, isModelInvocable and createUserMessage.
 */
export async function hostApi() {
  if (installed !== undefined) return installed
  pending ??= load().catch((error) => {
    pending = undefined
    throw error
  })
  return pending
}
