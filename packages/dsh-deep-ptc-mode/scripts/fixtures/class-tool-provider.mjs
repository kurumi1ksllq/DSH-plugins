// Offline host-integration fixture; no production task capability is added.
export default class RenamedOfficialCapability {
  static inject = ['tools'];
  constructor(ctx) {
    ctx.tools.register({ name: 'class_official_probe', description: 'Offline provenance check',
      parameters: { type: 'object' }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: () => 'official-class-result' });
  }
}
