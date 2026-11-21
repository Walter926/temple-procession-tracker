import { useState, type FormEvent } from 'react';
import { saveResource, errorMessage } from '../lib/management';
import { createSingleFlight } from '../lib/management_requests';
import type { GroupRecord } from '../types/domain';
const statuses = ['waiting', 'preparing', 'moving', 'stopped', 'delayed', 'arrived', 'completed', 'emergency'] as const;
export default function GroupStatusOverridePanel({ group }: { group: GroupRecord }) {
  const [status, setStatus] = useState<string>(group.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [flight] = useState(createSingleFlight);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); e.stopPropagation();
    if (!flight.start()) return;
    setBusy(true); setError(''); setNotice('');
    try { await saveResource('group', group.eventId, { status }, group.id); setNotice('Group status saved.'); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { flight.finish(); setBusy(false); }
  }
  return <form className="panel" onSubmit={submit}><h3>Group status</h3><label>Group status<select name="groupStatus" disabled={busy} value={status} onChange={e => setStatus(e.target.value)}>{statuses.map(s => <option key={s} value={s}>{s}</option>)}</select></label><div className="actions"><button disabled={busy}>{busy ? 'Saving...' : 'Update status'}</button></div>{error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}</form>;
}
