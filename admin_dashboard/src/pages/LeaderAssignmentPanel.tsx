import { useEffect, useState, type FormEvent } from 'react';
import { assignGroupLeaders } from '../lib/leader_assignments';
import { callManagement, errorMessage } from '../lib/management';
import type { GroupRecord, ManagementUserRecord } from '../types/domain';
import { eligibleLeader, leaderLabel, mergeProfiles } from '../lib/leader_profiles';
import { createSingleFlight } from '../lib/management_requests';

type DirectoryResult = { users: ManagementUserRecord[]; assignedUsers?: ManagementUserRecord[]; nextCursor: string | null };

export default function LeaderAssignmentPanel({ group }: { group: GroupRecord }) {
  const [users, setUsers] = useState<ManagementUserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [primaryId, setPrimaryId] = useState(group.leaderUserId || '');
  const [backupId, setBackupId] = useState(group.backupLeaderUserId || '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [directoryError, setDirectoryError] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [flight] = useState(createSingleFlight);
  useEffect(() => {
    let cancelled = false;
    callManagement<{ eventId: string; groupId: string }, DirectoryResult>('listAssignableLeaders', { eventId: group.eventId, groupId: group.id })
      .then(result => { if (!cancelled) { setUsers(mergeProfiles(result.assignedUsers ?? [], result.users)); setNextCursor(result.nextCursor); setLoading(false); } })
      .catch(reason => { if (!cancelled) { setDirectoryError(errorMessage(reason)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [group.eventId, group.id]);
  async function loadMore() {
    if (!flight.start()) return;
    setLoading(true); setDirectoryError('');
    try {
      const result = await callManagement<{ eventId: string; groupId: string; cursor: string | null }, DirectoryResult>('listAssignableLeaders', { eventId: group.eventId, groupId: group.id, cursor: nextCursor });
      setUsers(previous => mergeProfiles(previous, result.assignedUsers ?? [], result.users)); setNextCursor(result.nextCursor);
    } catch (reason) { setDirectoryError(errorMessage(reason)); }
    finally { flight.finish(); setLoading(false); }
  }
  const eligible = users.filter(u => eligibleLeader(u, group.id));
  const label = (id?: string) => id ? leaderLabel(users.find(u => u.id === id), true) : 'Unassigned';
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); event.stopPropagation();
    if (loading || directoryError || !flight.start()) return;
    setBusy(true); setMessage(''); setError('');
    try { await assignGroupLeaders(group.id, primaryId, backupId); setMessage('Leader assignments saved.'); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { flight.finish(); setBusy(false); }
  }
  const hasAssignments = !!(group.leaderUserId || group.backupLeaderUserId);
  async function release() {
    if (!hasAssignments || !flight.start()) return;
    try {
      if (!window.confirm("Release both primary and backup leaders? This revokes the primary leader's GPS publishing assignment for this group. The group and its data will not be deleted.")) return;
      setBusy(true); setMessage(''); setError('');
      await assignGroupLeaders(group.id, '', '');
      setPrimaryId(''); setBackupId('');
      setMessage('Leaders released. Their publishing assignment was removed. The group and its data have not been deleted.');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { flight.finish(); setBusy(false); }
  }
  return <section className="panel"><h3>Team leaders</h3><p>Primary: {label(group.leaderUserId)} · Backup: {label(group.backupLeaderUserId)}</p>
    {loading && <p role="status">Loading eligible leaders…</p>}
    {directoryError && <button type="button" disabled={loading || busy} onClick={() => void loadMore()}>Retry leader directory</button>}
    {nextCursor && <button type="button" disabled={loading} onClick={loadMore}>Load more leader accounts</button>}
    <form noValidate onSubmit={save} className="form-grid">
      <label>Primary leader<select name="primaryLeader" disabled={busy || loading} value={primaryId} onChange={e => setPrimaryId(e.target.value)}><option value="">Unassigned</option>
        {primaryId && !eligible.some(u => u.id === primaryId) && <option value={primaryId}>{label(primaryId)} (current)</option>}
        {eligible.map(u => <option key={u.id} value={u.id}>{leaderLabel(u)}</option>)}</select></label>
      <label>Backup leader<select name="backupLeader" disabled={busy || loading} value={backupId} onChange={e => setBackupId(e.target.value)}><option value="">No backup</option>
        {backupId && !eligible.some(u => u.id === backupId) && <option value={backupId}>{label(backupId)} (current)</option>}
        {eligible.map(u => <option key={u.id} value={u.id}>{leaderLabel(u)}</option>)}</select></label>
      <div className="span-2 actions"><button disabled={busy || loading || !!directoryError || (!!primaryId && primaryId === backupId)}>{busy ? 'Saving…' : 'Save leaders'}</button>
        {hasAssignments && <button type="button" disabled={busy || loading} onClick={() => void release()}>Release leaders</button>}</div>
    </form>
    {!!primaryId && primaryId === backupId && <p className="error">Choose different primary and backup leaders.</p>}
    {!loading && !eligible.length && !directoryError && <p>No available active team leaders. An administrator can manage accounts on Users.</p>}
    {(error || directoryError) && <p role="alert" className="error">{error || directoryError}</p>}{message && <p role="status">{message}</p>}
    <p className="subtle">Only the primary leader publishes GPS. Map access does not grant publishing rights. Promote a backup here to transfer responsibility. Release leaders to unassign both leaders and revoke primary GPS publishing rights without deleting the group or its data.</p>
  </section>;
}
