import { doc, onSnapshot } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from './firebase';
import { useSession } from '../context/AuthContext';
import type { EventRecord } from '../types/domain';
import { recordsPlan, type RecordsOptions, type RecordsPlan } from './record_queries';
import { firestoreRecordPager } from './firestore_records';
import type { RecordsState } from './record_pager';

export type Stored<T> = T & { id: string };

export function useRecords<T>(collectionName: string, requestedField?: string, requestedEquals?: string, options: RecordsOptions = {}) {
  const { user, role, isActive } = useSession();
  const uid = user?.uid, status = options.status;
  const plan = useMemo(() => recordsPlan(collectionName, { uid, role, isActive }, requestedField, requestedEquals, { status }),
    [collectionName, uid, role, isActive, requestedField, requestedEquals, status]);
  const { key, enabled } = plan;
  const [state, setState] = useState<RecordsState<Stored<T>> & { identity?: RecordsPlan }>({ items: [], loading: true, loadingMore: false, error: '', hasMore: false });
  const pagerRef = useRef<{ key: string; pager: ReturnType<typeof firestoreRecordPager<T>> } | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    const pager = firestoreRecordPager<T>(db, plan);
    pagerRef.current = { key, pager };
    const off = pager.subscribe(() => setState({ identity: plan, ...pager.getSnapshot() }));
    pager.start();
    return () => { off(); pager.dispose(); pagerRef.current = undefined; };
  }, [key, enabled, plan]);
  const loadMore = useCallback(() => { if (pagerRef.current?.key === key) void pagerRef.current.pager.loadMore(); }, [key]);
  const current = enabled && state.identity === plan ? state : { items: [] as Stored<T>[], loading: enabled, loadingMore: false, error: '', hasMore: false };
  return { ...current, loadMore };
}
export const useManagedEvents = () => useRecords<EventRecord>('events');

export function useManagedEvent(eventId?: string) {
  const { user, role, isActive } = useSession();
  const key = `${user?.uid}:${role}:${isActive}:${eventId}`;
  const [state, setState] = useState<{ key: string; event?: EventRecord; loading: boolean; error: string }>({ key: '', loading: true, error: '' });
  useEffect(() => {
    if (!eventId || !user || !isActive) return;
    return onSnapshot(doc(db, 'events', eventId), snapshot => {
      const event = snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } as EventRecord : undefined;
      if (event && role !== 'admin' && event.organizerId !== user.uid) { setState({ key, loading: false, error: 'You do not manage this event.' }); return; }
      setState({ key, event, loading: false, error: '' });
    }, reason => setState({ key, loading: false, error: reason.message }));
  }, [eventId, user, isActive, role, key]);
  return state.key === key ? state : { event: undefined, loading: !!eventId && isActive, error: '' };
}

export function useEventContacts(eventId?: string) {
  const [state, setState] = useState<{ eventId: string; contacts: { organizerContact: string; emergencyContact: string }; loading: boolean; error: string }>({ eventId: '', contacts: { organizerContact: '', emergencyContact: '' }, loading: false, error: '' });
  useEffect(() => {
    if (!eventId) return;
    const stop = onSnapshot(doc(db, 'eventContacts', eventId), (snapshot) => {
      const data = snapshot.data();
      setState({ eventId, contacts: { organizerContact: String(data?.organizerContact ?? ''), emergencyContact: String(data?.emergencyContact ?? '') }, loading: false, error: '' });
    }, (reason) => setState({ eventId, contacts: { organizerContact: '', emergencyContact: '' }, loading: false, error: reason.message }));
    return stop;
  }, [eventId]);
  if (!eventId) return { contacts: { organizerContact: '', emergencyContact: '' }, loading: false, error: '' };
  return state.eventId === eventId ? state : { contacts: { organizerContact: '', emergencyContact: '' }, loading: true, error: '' };
}
