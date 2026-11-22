import { useEffect, useState, type FormEvent } from 'react';
import { callManagement, errorMessage } from '../lib/management';
import { useManagedEvents, useRecords } from '../lib/records';
import QueryFeedback from '../components/QueryFeedback';
import type { AccessCodeRecord, GroupRecord } from '../types/domain';
import { accessCodeRequest, accessCodeStatus, DEFAULT_MAX_USES } from '../lib/access_code_contract';
import { createSingleFlight } from '../lib/management_requests';
import { useSession } from '../context/AuthContext';
import { useAssignedCodeScope } from '../lib/useAssignedCodeScope';
import { issuedCodeFormat } from '../lib/access_code_contract';

interface NewCode { code: string; id: string; expiresAtMs?: number }
export default function AccessCodesPage() {
  const { user, role } = useSession();
  const leader = role === 'teamLeader', assigned = useAssignedCodeScope();
  const managedEvents = useManagedEvents();
  const [selectedEvent, setEventId] = useState('');
  const eventId = leader ? assigned.event?.id ?? '' : selectedEvent;
  const managedGroups = useRecords<GroupRecord>('groups', 'eventId', leader ? '' : eventId);
  const [selectedGroup, setGroupId] = useState('');
  const groupId = leader ? assigned.group?.id ?? '' : selectedGroup;
  const events = leader ? { ...assigned, items: assigned.event ? [assigned.event] : [] } : managedEvents;
  const groups = leader ? { ...assigned, items: assigned.group ? [assigned.group] : [] } : managedGroups;
  const scopeKey = JSON.stringify([user?.uid, role, leader ? groupId : eventId]);
  const [fallbackScope, setFallbackScope] = useState('');
  const indexFree = fallbackScope === scopeKey;
  const codes = useRecords<AccessCodeRecord>('accessCodes', leader ? 'groupId' : 'eventId', leader ? groupId : eventId, { indexFree });
  // Adjust this query's mode when its external error changes, before rendering
  // an error screen; the new scoped plan disposes the failed subscription.
  if (!indexFree && /requires an index|index.*(?:building|not ready)/i.test(codes.error)) setFallbackScope(scopeKey);
  const [issued, setLatest] = useState<NewCode & { scopeKey: string }>();
  const latest = issued?.scopeKey === scopeKey ? issued : undefined;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [flight] = useState(createSingleFlight);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(timer); }, []);
  const event = events.items.find(e => e.id === eventId);
  const available = event && !['completed', 'cancelled', 'archived'].includes(event.status) && (!leader || !!groupId);
  const issuedCodes = [...codes.items].sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0) || a.id.localeCompare(b.id));
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); e.stopPropagation();
    if (!flight.start()) return;
    setBusy(true); setError(''); setLatest(undefined); setNotice('');
    try {
      if (!available || (groupId && !groups.items.some(g => g.id === groupId))) throw Error('Select an available event and a valid group.');
      const result = await callManagement<Record<string, unknown>, NewCode>('createAccessCode', accessCodeRequest(eventId, groupId));
      const format = issuedCodeFormat(result?.code);
      if (!format) throw Error('Backend deployment needed: ask an administrator to deploy the updated access-code functions, then generate a new code with exactly six digits.');
      if (typeof result.id !== 'string' || !result.id.trim() || (result.expiresAtMs != null &&
        (!Number.isSafeInteger(result.expiresAtMs) || result.expiresAtMs <= 0 || result.expiresAtMs > 8640000000000000))) {
        throw Error('The server returned an invalid code response. Ask an administrator to check the access-code backend before retrying.');
      }
      setLatest({ ...result, scopeKey });
      setNotice('Access code generated. Copy it below; issued-code history updates automatically.');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { flight.finish(); setBusy(false); }
  }
  async function revoke(id: string) {
    if (busy || !window.confirm('Revoke this access code? Existing memberships are unchanged.') || !flight.start()) return;
    setBusy(true); setError('');
    try { await callManagement('revokeAccessCode', { id }); if (latest?.id === id) setLatest(undefined); setNotice('Access code revoked.'); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { flight.finish(); setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(latest?.code ?? ''); setNotice('Code copied.'); }
    catch { setError('Unable to copy. Select the code and copy it manually.'); }
  }
  return <div><h1>Access codes</h1><p className="subtle">Six digits · Valid for 24 hours · Up to {DEFAULT_MAX_USES} eligible members per new code. Codes grant membership only, never leader publishing rights.</p>
    <form className="panel" noValidate onSubmit={submit}><div className="form-grid"><label>Event<select name="codeEvent" required disabled={busy || leader} value={eventId} onChange={e => { setEventId(e.target.value); setGroupId(''); setLatest(undefined); setNotice(''); setError(''); }}>
      <option value="">Choose event</option>{events.items.filter(e => !['completed', 'cancelled', 'archived'].includes(e.status)).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      <label>Scope<select name="codeScope" disabled={busy || leader} value={groupId} onChange={e => { setGroupId(e.target.value); setLatest(undefined); setNotice(''); setError(''); }}>{!leader && <option value="">Event membership (no group)</option>}{groups.items.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
    </div><QueryFeedback state={events} />{!leader && <QueryFeedback state={groups} />}<p>Assigned primary leaders can generate codes for their own group here or from the phone. Organizers manage codes for their events; administrators manage all events.</p>
    <button disabled={busy || !available}>{busy ? 'Working…' : 'Generate 24-hour code'}</button></form>
    {latest && <section className="panel"><h2>Share this code</h2><code className="access-code">{latest.code}</code><div className="actions"><button type="button" onClick={() => void copy()}>Copy code</button></div><p>Copy now. Plaintext codes cannot be retrieved later.{latest.expiresAtMs ? ` Expires ${new Date(latest.expiresAtMs).toLocaleString()}.` : ' Valid for 24 hours from creation.'}</p></section>}
    {eventId && <section className="panel"><h2>Issued codes</h2>{indexFree && <p role="status">The history index is not ready. Using index-free pages by code ID; loaded codes are sorted by creation time. Load more to inspect additional codes.</p>}<QueryFeedback state={codes} />{!codes.loading && !codes.error && !codes.items.length && <p>No codes issued for this {leader ? 'group' : 'event'}.</p>}
      <div className="list">{issuedCodes.map(code => { const status = accessCodeStatus(code, now); return <article className="item" key={code.id}><div><strong>{code.scope === 'group' ? groups.items.find(g => g.id === code.groupId)?.name ?? 'Group membership' : 'Event membership'}</strong><p>{code.usedCount ?? 0}{code.maxUses > 0 ? ` / ${code.maxUses}` : ''} joins · Expires {code.expiresAt?.toDate?.().toLocaleString() ?? 'Unavailable'} · <span className="badge">{status}</span></p></div><button type="button" disabled={busy || status === 'Revoked' || status === 'Expired'} onClick={() => void revoke(code.id)}>Revoke</button></article>; })}</div>
    </section>}{error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
  </div>;
}
