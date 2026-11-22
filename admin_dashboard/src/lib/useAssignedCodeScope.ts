import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { useSession } from '../context/AuthContext';
import type { EventRecord, GroupRecord } from '../types/domain';

type Scope = { key: string; group?: GroupRecord; event?: EventRecord; loading: boolean; error: string };

// Leaders read only their assigned group and its event, never a management list.
// The callable and Firestore rules independently verify the primary assignment.
export function useAssignedCodeScope(): Omit<Scope, 'key'> {
  const { user, role, isActive, assignedGroupId } = useSession();
  const uid = user?.uid, enabled = !!uid && isActive && role === 'teamLeader' && !!assignedGroupId;
  const key = JSON.stringify([uid, role, isActive, assignedGroupId]);
  const [scope, setScope] = useState<Scope>({ key: '', loading: false, error: '' });
  useEffect(() => {
    if (!enabled) return;
    let active = true, revision = 0;
    let stopEvent: (() => void) | undefined;
    const stopGroup = onSnapshot(doc(db, 'groups', assignedGroupId), snapshot => {
      if (!active) return;
      const current = ++revision;
      stopEvent?.();
      stopEvent = undefined;
      const data = snapshot.data();
      if (!data || data.deleting || data.leaderUserId !== uid || typeof data.eventId !== 'string' || !data.eventId) {
        setScope({ key, loading: false, error: 'Only the currently assigned primary leader can issue group codes. Ask the organizer to verify your assignment.' });
        return;
      }
      const group = { ...data, id: snapshot.id } as GroupRecord;
      setScope({ key, loading: true, error: '' });
      stopEvent = onSnapshot(doc(db, 'events', group.eventId), eventSnapshot => {
        if (!active || current !== revision) return;
        const eventData = eventSnapshot.data();
        if (!eventData || eventData.deleting) { setScope({ key, loading: false, error: 'Your assigned event is unavailable.' }); return; }
        setScope({ key, group, event: { ...eventData, id: eventSnapshot.id } as EventRecord, loading: false, error: '' });
      }, reason => { if (active && current === revision) setScope({ key, loading: false, error: reason.message }); });
    }, reason => { if (!active) return; revision++; stopEvent?.(); stopEvent = undefined; setScope({ key, loading: false, error: reason.message }); });
    return () => { active = false; revision++; stopGroup(); stopEvent?.(); };
  }, [enabled, uid, assignedGroupId, key]);
  if (!enabled) return { loading: false, error: role === 'teamLeader' ? 'Ask the organizer to assign you as the group’s primary leader before generating codes.' : '' };
  return scope.key === key ? scope : { loading: true, error: '' };
}
