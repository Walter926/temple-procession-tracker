import { useState, type FormEvent } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useSession } from '../context/AuthContext';
import type { GroupRecord } from '../types/domain';
const statuses = ['waiting', 'preparing', 'moving', 'stopped', 'delayed', 'arrived', 'completed', 'emergency'] as const;
export default function GroupStatusOverridePanel({ group }: { group: GroupRecord }) {
  const { role } = useSession();
  const [status, setStatus] = useState<string>(group.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (role !== 'admin') return null;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError('');
    try { await updateDoc(doc(db, 'groups', group.id), { status, statusUpdatedAt: serverTimestamp() }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to update group status.'); }
    finally { setBusy(false); }
  }
  return <form className="panel" onSubmit={submit}><h3>Admin Status Override</h3><label>Group status<select value={status} onChange={e => setStatus(e.target.value)}>{statuses.map(s => <option key={s} value={s}>{s}</option>)}</select></label><button disabled={busy}>{busy ? 'Saving...' : 'Override Status'}</button>{error && <p role="alert" className="error">{error}</p>}</form>;
}