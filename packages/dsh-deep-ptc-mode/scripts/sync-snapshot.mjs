// Regenerate the bundled fallback snapshots from the installed official declarations: the PTC preset
// and the shell executors of the base deployment.
// Maintainer tool: `npm run sync:snapshot [-- <preset.patch.yml> [<base.patch.yml>]]`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PRESET_META, personaFrom } from '../lib/model.mjs';
import { BASE_DECLARATION_SPECIFIER, loadOfficialPreset, parseOfficialExecutors } from '../lib/upstream.mjs';
import { resolveHost } from '../lib/host.mjs';

const snapshotUrl = new URL('../lib/preset.json', import.meta.url);
const previous = JSON.parse(readFileSync(snapshotUrl, 'utf8'));
const persona = personaFrom(previous);
const loaded = loadOfficialPreset(process.argv[2] === undefined ? {} : { presetPath: process.argv[2] });

const plugins = structuredClone(loaded.preset.plugins);
const personaIndex = plugins.findIndex(row => row && row.name === '@deepseek-ai/dsh-persona');
if (personaIndex === -1) plugins.unshift({ id: 'persona', name: '@deepseek-ai/dsh-persona', config: { ...persona } });
else plugins[personaIndex].config = { ...(plugins[personaIndex].config ?? {}), ...persona };

const snapshot = {
  id: PRESET_META.id,
  order: PRESET_META.order,
  plugins,
  name: PRESET_META.name,
  description: PRESET_META.description,
};
writeFileSync(snapshotUrl, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`snapshot: ${plugins.length} rows from ${loaded.source}`);

const baseUrl = process.argv[3] ?? resolveHost(BASE_DECLARATION_SPECIFIER);
if (baseUrl === undefined) throw new Error(`cannot resolve ${BASE_DECLARATION_SPECIFIER}; pass its path as the second argument`);
const basePath = baseUrl.startsWith('file:') ? fileURLToPath(baseUrl) : baseUrl;
const executors = parseOfficialExecutors(readFileSync(basePath, 'utf8'));
if (!executors.bash || !executors.pwsh) throw new Error(`${basePath} does not declare both shell executors`);
const version = JSON.parse(readFileSync(new URL('../compatibility.json', import.meta.url), 'utf8')).verifiedUpstream;
writeFileSync(new URL('../lib/base-snapshot.json', import.meta.url),
  `${JSON.stringify({ source: BASE_DECLARATION_SPECIFIER, verifiedUpstream: version, ...executors }, null, 2)}\n`);
console.log(`executors: ${executors.bash.name}, ${executors.pwsh.name} from ${basePath}`);
