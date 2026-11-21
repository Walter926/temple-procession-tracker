export type Resource = 'event' | 'route' | 'stop' | 'group' | 'segment';
export type SaveRequest = { operation: 'create' | 'update'; resource: Resource; eventId: string; id: string; data: Record<string, unknown> };

// A form owns its ID for its entire lifetime, including ambiguous network failures.
// The server must authorize and idempotently replay creates with this same ID.
export function createResourceWriter(resource: Resource, eventId: string, id: string, existing: boolean,
  send: (request: SaveRequest) => Promise<{ id: string }>) {
  let saved = existing, pending: Promise<string> | undefined, creationData: Record<string, unknown> | undefined;
  return (data: Record<string, unknown>): Promise<string> => {
    if (pending) return pending;
    if (!saved) creationData ??= structuredClone(data);
    const request: SaveRequest = { operation: saved ? 'update' : 'create', resource, eventId: resource === 'event' ? id : eventId, id, data: saved ? data : creationData! };
    pending = Promise.resolve().then(() => send(request)).then(async result => {
      if (result.id !== id) throw Error('The server returned an unexpected record ID. Reload before saving again.');
      saved = true;
      // Resolve an ambiguous create with its original fingerprint first. A user
      // may have corrected/edited fields while offline; apply those as an update.
      if (request.operation === 'create' && JSON.stringify(request.data) !== JSON.stringify(data)) {
        const updated = await send({ ...request, operation: 'update', data });
        if (updated.id !== id) throw Error('The server returned an unexpected record ID. Reload before saving again.');
      }
      creationData = undefined;
      return id;
    }).catch(reason => {
      const failure = reason as { code?: string; cause?: { code?: string } };
      const code = (failure?.code ?? failure?.cause?.code ?? '').replace(/^functions\//, '');
      // These responses explicitly reject the write, so corrected data may be
      // submitted under the same ID. Network/internal failures remain ambiguous.
      if (['invalid-argument', 'failed-precondition', 'permission-denied', 'unauthenticated'].includes(code)) creationData = undefined;
      throw reason;
    }).finally(() => { pending = undefined; });
    return pending;
  };
}

export function createSingleFlight() {
  let pending = false;
  return { start: () => { if (pending) return false; pending = true; return true; }, finish: () => { pending = false; } };
}
