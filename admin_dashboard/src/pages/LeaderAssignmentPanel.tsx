import { useState, type FormEvent } from 'react';
import { useSession } from '../context/AuthContext';
import { assignGroupLeaders } from '../lib/leader_assignments';
import { useRecords } from '../lib/records';
import type { GroupRecord, ManagementUserRecord } from '../types/domain';

interface Props { group: GroupRecord }

export default function LeaderAssignmentPanel({ group }: Props) {
  const { role } = useSession();
  const users = useRecords<ManagementUserRecord>('users');
  const [primaryId, setPrimaryId] = useState(group.leaderUserId || '');
  const [backupId, setBackupId] = useState(group.backupLeaderUserId || '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const eligible = users.items.filter((user) => user.role === 'teamLeader' && user.isActive === true && (!user.assignedGroupId || user.assignedGroupId === group.id));
  const visible = (id: string) => users.items.find((user) => user.id === id);
  const leader = visible(group.leaderUserId);
  const backup = visible(group.backupLeaderUserId ?? '');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');

    try {
      await assignGroupLeaders(group.id, primaryId, backupId);
      setMessage('Leader assignment saved.');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Assignment failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h3>Team Leaders</h3>

      <div className="inline">
        {[{ user: leader, title: 'Primary leader' }, { user: backup, title: 'Backup leader' }].map(({ user, title }) => (
          <div key={title}>
            {user?.photoUrl ? <img src={user.photoUrl} alt="" width={48} height={48} style={{ borderRadius: '50%', objectFit: 'cover' }} /> : <span aria-hidden="true">👤</span>}
            <p><strong>{title}:</strong> {user?.displayName || user?.email || 'Unassigned'}</p>
          </div>
        ))}
      </div>

      {role === 'admin' && (
        <form onSubmit={save} className="form-grid">
          <label>Primary leader<select value={primaryId} onChange={(event) => setPrimaryId(event.target.value)}>
            <option value="">Unassigned</option>
            {eligible.map((user) => <option key={user.id} value={user.id}>{user.displayName || user.email}</option>)}
          </select></label>

          <label>Backup leader<select value={backupId} onChange={(event) => setBackupId(event.target.value)}>
            <option value="">No backup</option>
            {eligible.map((user) => <option key={user.id} value={user.id}>{user.displayName || user.email}</option>)}
          </select></label>

          <div className="span-2"><button type="submit" disabled={busy || users.loading || !!users.error}>{busy ? 'Saving...' : 'Save Leaders'}</button></div>
        </form>
      )}

      {users.error && <p role="alert" className="error">{users.error}</p>}
      {message && <p role="status">{message}</p>}
      <p className="subtle">Backup leaders can view assignments. Only the primary leader can send GPS until an administrator promotes the backup.</p>
    </section>
  );
}