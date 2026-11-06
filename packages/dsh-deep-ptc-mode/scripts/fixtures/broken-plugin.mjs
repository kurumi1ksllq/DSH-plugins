// A third-party plugin that cannot start on this host.
export const name = 'broken-plugin';
export function apply() {
  throw new Error('this plugin does not support the installed Harness');
}
