#!/usr/bin/env node
/**
 * Narrow the model-facing skill catalog to a named keep set.
 *
 * Every session renders the catalog from every skill the filesystem provider
 * finds, so a machine with 269 installed skills offers the model 269 choices and
 * measured sessions load almost none of them. This tool keeps the named set
 * model-visible and marks the rest `disable-model-invocation: true` — still
 * loadable by the user as `/name`, invisible to the model. Nothing is deleted or
 * moved, and `--restore` puts every skill back in the catalog.
 *
 * usage: skill-catalog [--root <dir>] (--keep a,b,c | --keep-file <path> | --restore)
 *                      [--dry-run] [--json]
 *
 * exit 0: selection applied (or planned with --dry-run)
 * exit 1: usage error, or the root directory does not exist
 * exit 2: a keep name matched nothing, or one skill file could not be edited
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { scanSkillRoots } from '../lib/scan-skills.js'
import { applySelection } from '../lib/skill-selection.js'

const USAGE = 'usage: skill-catalog [--root <dir>] (--keep a,b,c | --keep-file <path> | --restore) [--dry-run] [--json]'

/** The root the filesystem provider scans for user-level skills. */
function defaultRoot() {
  const agentsHome = typeof process.env.DSH_AGENTS_HOME === 'string' && process.env.DSH_AGENTS_HOME.trim() !== ''
    ? process.env.DSH_AGENTS_HOME.trim()
    : join(homedir(), '.agents')
  return join(agentsHome, 'skills')
}

/**
 * Parse argv into options.
 * @param {string[]} argv - process arguments after the script name.
 * @returns {{root: string, keep: string[]|null, restore: boolean, dryRun: boolean, json: boolean}}
 */
function parseArgs(argv) {
  const options = { root: defaultRoot(), keep: null, restore: false, dryRun: false, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = () => {
      const next = argv[index + 1]
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value`)
      index += 1
      return next
    }
    if (arg === '--root') options.root = resolve(value())
    else if (arg.startsWith('--root=')) options.root = resolve(arg.slice('--root='.length))
    else if (arg === '--keep') options.keep = splitNames(value())
    else if (arg.startsWith('--keep=')) options.keep = splitNames(arg.slice('--keep='.length))
    else if (arg === '--keep-file') options.keep = readNameFile(value())
    else if (arg.startsWith('--keep-file=')) options.keep = readNameFile(arg.slice('--keep-file='.length))
    else if (arg === '--restore') options.restore = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') throw new Error('help')
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (options.restore && options.keep !== null) throw new Error('--restore and --keep are mutually exclusive')
  if (!options.restore && options.keep === null) throw new Error('one of --keep, --keep-file or --restore is required')
  return options
}

/** Split a comma/whitespace separated name list. */
function splitNames(raw) {
  return String(raw).split(/[\s,]+/u).map((name) => name.trim()).filter((name) => name.length > 0)
}

/** Read a keep list from a file: one name per line, `#` comments ignored, commas allowed. */
function readNameFile(path) {
  const text = readFileSync(path, 'utf8')
  return text
    .split('\n')
    .map((line) => line.replace(/#.*/u, '').trim())
    .flatMap((line) => (line.length === 0 ? [] : splitNames(line)))
}

function main(argv) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    if (error && error.message === 'help') {
      console.log(USAGE)
      return 0
    }
    console.error(String(error && error.message ? error.message : error))
    console.error(USAGE)
    return 1
  }

  if (!existsSync(options.root)) {
    console.error(`skill root does not exist: ${options.root}`)
    return 1
  }

  const { skills } = scanSkillRoots([{ dir: options.root, source: 'user-agents', rank: 500 }])
  const keep = options.restore ? skills.map((skill) => skill.name) : options.keep
  const report = applySelection({ skills, keep, dryRun: options.dryRun })

  const summary = {
    root: options.root,
    scanned: skills.length,
    keep: keep.length,
    visibleAfter: skills.length - report.marked.length + report.unmarked.length,
    marked: report.marked,
    unmarked: report.unmarked,
    unknown: report.unknown,
    failed: report.failed,
    dryRun: report.dryRun,
  }
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2))
  } else {
    const verb = report.dryRun ? 'would change' : 'changed'
    console.log(`root:      ${summary.root}`)
    console.log(`scanned:   ${summary.scanned}`)
    console.log(`model-visible after: ${summary.visibleAfter}`)
    console.log(`${verb}:   ${report.marked.length} hidden, ${report.unmarked.length} restored`)
    if (report.unknown.length > 0) console.log(`unknown keep names: ${report.unknown.join(', ')}`)
    for (const failure of report.failed) console.log(`failed: ${failure.name}: ${failure.message}`)
  }
  return report.unknown.length > 0 || report.failed.length > 0 ? 2 : 0
}

process.exitCode = main(process.argv.slice(2))
