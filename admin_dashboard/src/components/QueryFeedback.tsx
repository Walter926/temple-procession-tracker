interface QueryState { loading: boolean; loadingMore?: boolean; error: string; hasMore?: boolean; loadMore?: () => void }
export default function QueryFeedback({ state }: { state: QueryState }) {
  return <>{state.loading && <p role="status">Loading…</p>}{state.error && <p role="alert" className="error">{state.error}</p>}
    {state.hasMore && <p className="inline">Showing a limited page. <button type="button" disabled={state.loading || state.loadingMore} onClick={state.loadMore}>{state.loadingMore ? 'Loading more…' : 'Load more'}</button></p>}</>;
}
