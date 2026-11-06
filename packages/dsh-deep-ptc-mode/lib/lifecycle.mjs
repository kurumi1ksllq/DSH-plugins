// Serialize definition replacement. The registry retains revisions used by old sessions.
export function presetLifecycle(register, getDefinition, onError) {
  let disposed = false;
  let unregister;
  let queue = Promise.resolve();
  const refresh = () => {
    queue = queue.then(async () => {
      if (disposed) return;
      const definition = await getDefinition(); // Validate before removing the last good definition.
      await unregister?.();
      unregister = undefined;
      if (disposed) return;
      const release = await register(definition);
      if (disposed) await release();
      else unregister = release;
    });
    const operation = queue;
    queue = operation.catch(error => onError(error));
    return operation;
  };
  return {
    refresh,
    async dispose() {
      disposed = true;
      await queue;
      await unregister?.();
      unregister = undefined;
    },
  };
}
