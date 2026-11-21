import { collection, documentId, endBefore, getDocFromServer, getDocsFromServer, limit, onSnapshot, orderBy, query, startAfter, where,
  type Firestore, type QueryDocumentSnapshot } from 'firebase/firestore';
import { createRecordPager, type RecordRow } from './record_pager.ts';
import type { RecordsPlan } from './record_queries.ts';

type Stored<T> = T & { id: string };
type Row<T> = RecordRow<Stored<T>, QueryDocumentSnapshot>;

export function firestoreRecordPager<T>(db: Firestore, plan: RecordsPlan) {
  const base = query(collection(db, plan.collectionName), ...plan.filters.map(filter => where(filter.field, '==', filter.value)),
    ...plan.order.map(order => orderBy(order.field === '__name__' ? documentId() : order.field, order.direction)));
  const row = (snapshot: QueryDocumentSnapshot): Row<T> => ({ id: snapshot.id, value: { ...snapshot.data(), id: snapshot.id } as Stored<T>, cursor: snapshot });
  return createRecordPager<Stored<T>, QueryDocumentSnapshot>({
    listen: (next, failed) => onSnapshot(query(base, limit(plan.pageSize)), snapshot => next(snapshot.docs.map(row)), failed),
    read: async (after, before) => (await getDocsFromServer(query(base, startAfter(after), ...(before ? [endBefore(before)] : []), limit(plan.pageSize)))).docs.map(row),
    refresh: async previous => {
      const snapshot = await getDocFromServer(previous.cursor.ref);
      if (!snapshot.exists() || !plan.filters.every(filter => snapshot.get(filter.field) === filter.value) ||
        !plan.order.every(order => order.field === '__name__' || snapshot.get(order.field) !== undefined)) return;
      return row(snapshot);
    },
    compare: (a, b) => {
      for (const order of plan.order) {
        // Firestore Timestamp.valueOf preserves nanoseconds and lexical ordering.
        const left = order.field === '__name__' ? a.id : a.cursor.get(order.field)?.valueOf();
        const right = order.field === '__name__' ? b.id : b.cursor.get(order.field)?.valueOf();
        if (left < right) return order.direction === 'asc' ? -1 : 1;
        if (left > right) return order.direction === 'asc' ? 1 : -1;
      }
      return 0;
    },
  }, plan.pageSize);
}
