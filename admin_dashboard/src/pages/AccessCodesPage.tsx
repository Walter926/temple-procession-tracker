import { useState, type FormEvent } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { firebaseApp } from '../lib/firebase';
import { useRecords } from '../lib/records';
import type { AccessCodeRecord, EventRecord, GroupRecord } from '../types/domain';

type CreateResult = { code: string; id: string };
const functions = getFunctions(firebaseApp);
const createCode = httpsCallable<Record<string, unknown>, CreateResult>(functions, 'createAccessCode');
const revokeCode = httpsCallable<{ id: string }, { revoked: boolean }>(functions, 'revokeAccessCode');

export default function AccessCodesPage() {
  const events = useRecords<EventRecord>('events');
  const [eventId, setEventId] = useState('');
  const groups = useRecords<GroupRecord>('groups', 'eventId', eventId);
  const codes = useRecords<AccessCodeRecord>('accessCodes', 'eventId', eventId);
  const [groupId, setGroupId] = useState('');
  const [days, setDays] = useState('7');
  const [maxUses, setMaxUses] = useState('25');
  const [enabled, setEnabled] = useState(true);
  const [latest, setLatest] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(''); setLatest('');
    try {
      const expiresAtMs = Date.now() + Number(days) * 86400000;
      const result = await createCode({ eventId, groupId, scope: groupId ? 'group' : 'event', grantedRole: 'teamMember', expiresAtMs, maxUses: Number(maxUses), enabled });
      setLatest(result.data.code);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to create access code.'); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    if (!window.confirm('Revoke this access code?')) return;
    try { await revokeCode({ id }); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to revoke code.'); }
  }
  return <div><h1>Access Codes</h1><form className="panel form-grid" onSubmit={submit}>
    <label>Event<select required value={eventId} onChange={(e) => { setEventId(e.target.value); setGroupId(''); setLatest(''); }}>
      <option value="">Choose event</option>{events.items.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
    </select></label>
    <label>Scope / group<select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
      <option value="">Event-level code</option>{groups.items.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
    </select></label>
    <label>Role granted<select value="teamMember" disabled><option value="teamMember">Team member (membership only)</option></select></label>
    <label>Valid for (days)<input type="number" required min="1" max="365" value={days} onChange={(e) => setDays(e.target.value)} /></label>
    <label>Maximum uses<input type="number" required min="1" max="1000" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} /></label>
    <label className="inline"><input type="checkbox" style={{ width: 'auto' }} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Enabled</label>
    <div className="span-2"><button type="submit" disabled={busy || !eventId}>{busy ? 'Creating...' : 'Generate Code'}</button></div>
  </form>
    {latest && <section className="panel"><h3>New code — copy now</h3><code>{latest}</code> <button onClick={() => void navigator.clipboard.writeText(latest)}>Copy</button><p>Codes are not stored in plaintext. You cannot retrieve this value later.</p></section>}
    {error && <p role="alert" className="error">{error}</p>}
    {eventId && <section className="panel"><h2>Issued codes</h2>{codes.error && <p role="alert" className="error">{codes.error}</p>}
      {codes.items.map((code) => <div className="item" key={code.id}>
        <span>{code.scope} · {code.usedCount}/{code.maxUses} uses · expires {code.expiresAt.toDate().toLocaleDateString()} · {code.enabled ? 'Enabled' : 'Revoked'}</span>
        <button type="button" disabled={!code.enabled} onClick={() => void revoke(code.id)}>Revoke</button>
      </div>)}
    </section>}
  </div>;
}