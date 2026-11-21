export type RecordRow<T, Cursor> = { id: string; value: T; cursor: Cursor };
export type RecordsState<T> = { items: T[]; loading: boolean; loadingMore: boolean; error: string; hasMore: boolean };
export type RecordsSource<T, Cursor> = {
  listen: (next: (rows: RecordRow<T, Cursor>[]) => void, failed: (error: Error) => void) => () => void;
  read: (after: Cursor, before?: Cursor) => Promise<RecordRow<T, Cursor>[]>;
  refresh: (row: RecordRow<T, Cursor>) => Promise<RecordRow<T, Cursor> | undefined>;
  compare: (a: RecordRow<T, Cursor>, b: RecordRow<T, Cursor>) => number;
};

// One bounded listener; historical pages are fetched once, never by increasing
// the listener limit. A cursor is a full snapshot (including the ID tie-breaker).
export function createRecordPager<T, Cursor>(source: RecordsSource<T, Cursor>, pageSize: number) {
  type Row = RecordRow<T, Cursor>;
  let state: RecordsState<T> = { items: [], loading: true, loadingMore: false, error: '', hasMore: false };
  let head: Row[] = [];
  const history = new Map<string, Row>();
  const versions = new Map<string, number>();
  let revision = 0;
  const listeners = new Set<() => void>();
  let cursor: Row | undefined;
  let exhausted = false, historyStarted = false, disposed = false, failed = false;
  let stop: (() => void) | undefined;
  // A burst larger than the live window can leave an unseen interval between
  // the new head and previously loaded history. Fill it with bounded pages too.
  const gaps: { after: Row; before: Row }[] = [];
  function publish(patch: Partial<RecordsState<T>>) {
    if (disposed) return;
    const merged = new Map(history);
    for (const row of head) merged.set(row.id, row);
    state = { ...state, ...patch, items: [...merged.values()].sort(source.compare).map(row => row.value) };
    state.hasMore = !state.loading && !failed && (gaps.length > 0 || !exhausted);
    listeners.forEach(listener => listener());
  }
  function start() {
    if (stop || disposed) return;
    stop = source.listen(rows => {
      if (disposed || failed) return;
      const previous = head;
      const version = ++revision;
      if (!historyStarted) versions.clear();
      if (historyStarted) {
        const tail = rows.at(-1), first = previous[0];
        if (rows.length === pageSize && tail && first && source.compare(tail, first) < 0) gaps.unshift({ after: tail, before: first });
        for (const row of previous) history.set(row.id, row);
      }
      head = rows;
      for (const row of rows) {
        versions.set(row.id, version);
        if (history.has(row.id)) history.set(row.id, row);
      }
      if (!historyStarted) { cursor = rows.at(-1); exhausted = rows.length < pageSize; }
      publish({ loading: false, error: '' });
      if (historyStarted) {
        const ids = new Set(rows.map(row => row.id));
        for (const row of previous) if (!ids.has(row.id)) {
          versions.set(row.id, version);
          // A limited-query removal may be an eviction, a deletion, or a status
          // change. Recheck just that document rather than rereading the prefix.
          void source.refresh(row).then(fresh => {
            if (disposed || failed || versions.get(row.id) !== version || head.some(item => item.id === row.id)) return;
            versions.set(row.id, ++revision);
            if (fresh) history.set(row.id, fresh); else history.delete(row.id);
            publish({});
          }).catch((error: Error) => {
            if (disposed || failed || versions.get(row.id) !== version || head.some(item => item.id === row.id)) return;
            versions.set(row.id, ++revision);
            history.delete(row.id);
            publish({ error: error.message });
          });
        }
      }
    }, error => {
      // A failed live query must not leave apparently current operational data.
      failed = true; head = []; history.clear(); versions.clear(); gaps.length = 0; exhausted = true;
      publish({ loading: false, loadingMore: false, error: error.message });
    });
  }
  async function loadMore() {
    if (disposed || state.loading || state.loadingMore || !state.hasMore || !cursor) return;
    historyStarted = true;
    const gap = gaps[0], after = gap?.after ?? cursor;
    const requestedAt = revision;
    publish({ loadingMore: true, error: '' });
    try {
      const rows = await source.read(after.cursor, gap?.before.cursor);
      if (disposed || failed) return;
      // Never let an in-flight historical snapshot resurrect a deleted/status-
      // changed record or overwrite a more recent live observation.
      for (const row of rows) if ((versions.get(row.id) ?? 0) <= requestedAt) history.set(row.id, row);
      if (gap) {
        if (rows.length < pageSize) gaps.splice(gaps.indexOf(gap), 1);
        else gap.after = rows.at(-1)!;
      } else {
        cursor = rows.at(-1) ?? cursor;
        exhausted = rows.length < pageSize;
      }
      publish({ loadingMore: false });
    } catch (error) {
      if (!disposed && !failed) publish({ loadingMore: false, error: error instanceof Error ? error.message : 'Unable to load more records.' });
    }
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start,
    loadMore,
    dispose: () => { disposed = true; stop?.(); listeners.clear(); history.clear(); versions.clear(); gaps.length = 0; },
  };
}
