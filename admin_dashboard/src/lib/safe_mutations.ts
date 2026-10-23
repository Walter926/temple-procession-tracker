import { arrayRemove, collection, doc, getDocsFromServer, query, runTransaction, where } from 'firebase/firestore';
import { db } from './firebase';

type FoundRecord = Record<string, unknown> & { id: string };

async function matching(collectionName: string, field: string, value: string): Promise<FoundRecord[]> {
  const snapshot = await getDocsFromServer(query(collection(db, collectionName), where(field, '==', value)));
  return snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));
}

export async function deleteDraftRoute(eventId: string, routeId: string) {
  const [segments, stops, groups] = await Promise.all([
    matching('routeSegments', 'routeId', routeId), matching('stopPoints', 'routeId', routeId), matching('groups', 'eventId', eventId),
  ]);

  if (segments.length || stops.length || groups.some((item) => item.routeId === routeId)) throw Error('This route has segment, stop, or group references.');

  await runTransaction(db, async (tx) => {
    const eventRef = doc(db, 'events', eventId), routeRef = doc(db, 'routes', routeId);
    const [event, route] = await Promise.all([tx.get(eventRef), tx.get(routeRef)]);
    if (!event.exists() || event.data().status !== 'draft') throw Error('Only draft-event routes may be deleted.');
    if (!route.exists() || route.data().eventId !== eventId || event.data().routeId === routeId) throw Error('This route is unavailable or currently primary.');
    tx.delete(routeRef);
  });
}

export async function deleteDraftStop(eventId: string, routeId: string, stopId: string) {
  const [groups, segments] = await Promise.all([matching('groups', 'eventId', eventId), matching('routeSegments', 'routeId', routeId)]);

  if ([...groups, ...segments].some((item) => ['startingStopPointId', 'endingStopPointId', 'startStopPointId', 'endStopPointId'].some((key) => item[key] === stopId))) {
    throw Error('A group or segment uses this stop.');
  }

  await runTransaction(db, async (tx) => {
    const eventRef = doc(db, 'events', eventId), routeRef = doc(db, 'routes', routeId), stopRef = doc(db, 'stopPoints', stopId);
    const [event, route, stop] = await Promise.all([tx.get(eventRef), tx.get(routeRef), tx.get(stopRef)]);
    if (!event.exists() || event.data().status !== 'draft') throw Error('Only draft-event stops may be deleted.');
    if (!route.exists() || route.data().eventId !== eventId || !stop.exists() || stop.data().routeId !== routeId) throw Error('Stop or route relationship changed.');
    tx.delete(stopRef);
    tx.update(routeRef, { stopPointIds: arrayRemove(stopId) });
  });
}

export async function deleteDraftGroup(eventId: string, groupId: string) {
  await runTransaction(db, async (tx) => {
    const eventRef = doc(db, 'events', eventId), groupRef = doc(db, 'groups', groupId);
    const [event, group] = await Promise.all([tx.get(eventRef), tx.get(groupRef)]);
    if (!event.exists() || event.data().status !== 'draft') throw Error('Only draft-event groups may be deleted.');
    if (!group.exists() || group.data().eventId !== eventId) throw Error('Group missing or event changed.');

    if (group.data().leaderUserId || group.data().backupLeaderUserId || group.data().memberCount !== 0 || group.data().accessCodeId) {
      throw Error('Unassign primary/backup leaders, members, and codes before deletion.');
    }

    tx.delete(groupRef);
  });
}