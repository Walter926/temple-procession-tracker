import { useEffect, useMemo, useState } from 'react';
import { onChildAdded, onChildChanged, onChildRemoved, ref } from 'firebase/database';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db, rtdb } from './firebase';
import type { RouteRecord, StopPointRecord } from '../types/domain';
import { emptyLiveEvent, subscribeLiveEvent, type LiveState } from './live_data';
import { useSession } from '../context/AuthContext';

export type { TrackingState } from './live_data';
export function useLiveEvent(eventId: string) {
  const { user, role, isActive } = useSession();
  const uid = user?.uid;
  const scope = useMemo(() => ({ empty: emptyLiveEvent(eventId), uid, role, isActive }), [eventId, uid, role, isActive]);
  const [state, setState] = useState<{ identity?: typeof scope; value: LiveState }>(() => ({ value: emptyLiveEvent('') }));
  useEffect(() => {
    if (!eventId || !uid || !isActive) return;
    return subscribeLiveEvent(eventId, (path, upsert, remove, failed) => {
      const source = ref(rtdb, path);
      const update = (snapshot: import('firebase/database').DataSnapshot) => { if (snapshot.key) upsert(snapshot.key, snapshot.val()); };
      const stops = [onChildAdded(source, update, failed), onChildChanged(source, update, failed),
        onChildRemoved(source, snapshot => { if (snapshot.key) remove(snapshot.key); }, failed)];
      return () => stops.forEach(stop => stop());
    }, value => setState({ identity: scope, value }), publish => {
      const frame = requestAnimationFrame(publish);
      return () => cancelAnimationFrame(frame);
    });
  }, [eventId, uid, isActive, scope]);
  return state.identity === scope ? state.value : scope.empty;
}

// Stops have routeId, not eventId. Subscribe only to this event's validated routes.
export function useRouteStops(routes: RouteRecord[]) {
  const key = routes.map(route => route.id).sort().join(',');
  const [state, setState] = useState<{ key: string; byRoute: Record<string, StopPointRecord[]>; error: string }>({ key: '', byRoute: {}, error: '' });
  useEffect(() => {
    if (!key) return;
    let byRoute: Record<string, StopPointRecord[]> = {};
    const stops = key.split(',').map(routeId => onSnapshot(query(collection(db, 'stopPoints'), where('routeId', '==', routeId)), snapshot => {
      byRoute = { ...byRoute, [routeId]: snapshot.docs.map(item => ({ ...item.data(), id: item.id } as StopPointRecord)) };
      setState({ key, byRoute, error: '' });
    }, reason => setState({ key, byRoute, error: reason.message })));
    return () => stops.forEach(stop => stop());
  }, [key]);
  const items = useMemo(() => state.key === key ? Object.values(state.byRoute).flat() : [], [state.key, state.byRoute, key]);
  return { items, loading: !!key && (state.key !== key || Object.keys(state.byRoute).length < routes.length), error: state.key === key ? state.error : '' };
}
