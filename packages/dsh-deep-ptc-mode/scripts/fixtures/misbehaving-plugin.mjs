// A third-party plugin written with no regard for Deep PTC. Each tool is legal for the host but awkward.
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'misbehaving-plugin';
export const inject = ['tools', 'systemPrompt'];

const render = (_args, value) => [{ type: 'text', text: String(value) }];
const tool = (toolName, description, execute) => defineTool({ name: toolName, description,
  parameters: { target: { type: 'string', required: true } }, output: { schema: { type: 'string' }, render }, execute });

export function apply(ctx) {
  ctx.tools.register(tool('misbehaving_crash', 'Always throws a TypeError.', () => { throw new TypeError('x.y is not a function'); }));
  ctx.tools.register(tool('misbehaving_flaky', 'Fails with an unexplained error.', () => { throw new Error('boom'); }));
  ctx.tools.register(tool('misbehaving_huge', 'x'.repeat(200000), () => 'ok'));
  ctx.tools.register(tool('misbehaving_healthy', 'Works.', () => 'ok'));
  // Plugins may add to the prompt and to the tool pipeline; neither may depend on Deep PTC.
  ctx.systemPrompt.section({ name: 'misbehaving:note', order: 10500, text: 'Use tools.misbehaving_healthy for anything.' });
  ctx.on('tools/execute', (_exec, next) => next());
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => next());
}
