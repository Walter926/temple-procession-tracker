import { addDoc, collection, doc, onSnapshot, query, updateDoc, where, type DocumentData, type Unsubscribe } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from './firebase';

export type Stored<T> = T & { id: string };

export function useRecords<T>(collectionName: string, field?: string, equals?: string) {
  const key = `${collectionName}:${field ?? ''}:${equals ?? ''}`;
  const [state, setState] = useState<{ key: string; items: Stored<T>[]; loading: boolean; error: string }>({ key, items: [], loading: true, error: '' });
  useEffect(() => {
    if (field && !equals) return;
    const base = collection(db, collectionName);
    const source = field && equals ? query(base, where(field, '==', equals)) : base;
    const stop: Unsubscribe = onSnapshot(source, (snapshot) => {
      setState({ key, items: snapshot.docs.map((item) => ({ ...item.data(), id: item.id } as Stored<T>)), loading: false, error: '' });
    }, (reason) => setState({ key, items: [], loading: false, error: reason.message }));
    return stop;
  }, [collectionName, field, equals, key]);
  if (field && !equals) return { items: [] as Stored<T>[], loading: false, error: '' };
  return state.key === key ? state : { items: [] as Stored<T>[], loading: true, error: '' };
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

export async function createRecord(collectionName: string, value: DocumentData) { return (await addDoc(collection(db, collectionName), value)).id; }
export async function patchRecord(collectionName: string, id: string, value: DocumentData) { await updateDoc(doc(db, collectionName, id), value); }