import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Timestamp } from 'firebase/firestore';
import { useManagedEvents, useRecords } from '../lib/records';
import { callManagement, errorMessage } from '../lib/management';
import QueryFeedback from '../components/QueryFeedback';
import type { GroupRecord } from '../types/domain';

interface Suggestion {
  id: string; eventId: string; groupId?: string; groupIds?: string[]; alertId?: string; incidentId?: string;
  reason?: string; rationale?: string; message?: string; sourceType?: string; kind?: string; instruction?: string; action?: string;
  status?: string; isAccepted?: boolean; suggestedRouteSegmentIds?: string[]; createdAt?: Timestamp; expiresAt?: Timestamp; decidedAt?: Timestamp;
}
const kinds = ['wait_at_current_stop', 'delay_departure', 'proceed_to_next_checkpoint', 'use_alternate_route', 'skip_optional_stop'];
function suggestionKind(suggestion: Suggestion): string {
  const kind = suggestion.kind ?? '';
  return kinds.includes(kind) ? kind : 'wait_at_current_stop';
}
function suggestionInstruction(suggestion: Suggestion): string {
  return suggestion.instruction ?? suggestion.message ?? suggestion.reason ?? suggestion.rationale ?? '';
}
export default function RouteSuggestionsPage() {
  const events = useManagedEvents();
  const [params, setParams] = useSearchParams();
  const eventId = events.items.find(e => e.id === params.get('event'))?.id ?? '';
  const [adviceFilter, setAdviceFilter] = useState('pending');
  const suggestions = useRecords<Suggestion>('routeSuggestions', 'eventId', eventId, { status: adviceFilter });
  const groups = useRecords<GroupRecord>('groups', 'eventId', eventId);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [kindById, setKindById] = useState<Record<string, string>>({});
  const [textById, setTextById] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(timer); }, []);
  async function decide(suggestion: Suggestion, decision: 'approved' | 'rejected') {
    if (busyId) return;
    if (!suggestion.groupId || !suggestion.alertId || !suggestion.incidentId) {
      setError('This legacy advice must be regenerated for a current incident before a decision can be made.'); return;
    }
    const kind = kindById[suggestion.id] ?? suggestionKind(suggestion);
    const instruction = (textById[suggestion.id] ?? suggestionInstruction(suggestion)).trim();
    if (decision === 'approved' && (!kinds.includes(kind) || !instruction || instruction.length > 500)) {
      setError('Choose a supported action and enter an instruction containing 1–500 characters.'); return;
    }
    setBusyId(suggestion.id); setError(''); setNotice('');
    try {
      const result = await callManagement<{ suggestionId: string; decision: 'approved' | 'rejected'; kind?: string; instruction?: string }, { status: string; alreadyDecided?: boolean }>('decideRouteSuggestion', { suggestionId: suggestion.id, decision, ...(decision === 'approved' ? { kind, instruction } : {}) });
      setNotice(result.alreadyDecided ? `This suggestion was already ${result.status}.` : result.status === 'approved' ? 'Suggestion approved. The server has queued the instruction for the assigned leader.' : `Suggestion ${result.status}.`);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusyId(''); }
  }
  const sorted = [...suggestions.items].sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
  return <div><h1>Route suggestions</h1><p className="subtle">Review route advice for your events. Approval sends an instruction to the current affected leader, not a geometry change.</p>
    <section className="panel"><label>Event<select value={eventId} onChange={e => { setParams(e.target.value ? { event: e.target.value } : {}); setNotice(''); setError(''); }}><option value="">Choose an event</option>{events.items.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label><QueryFeedback state={events} /></section>
    {eventId && <section className="panel"><label>Advice<select value={adviceFilter} onChange={e => setAdviceFilter(e.target.value)}><option value="pending">Pending decisions</option><option value="">All advice and history</option></select></label><QueryFeedback state={suggestions} /><QueryFeedback state={groups} />
      {!suggestions.loading && !suggestions.error && !sorted.length && <div className="empty-state"><h2>No route advice to review</h2><p>Suggestions appear when a fresh active collision needs operator coordination. Check the live map or collision alerts for current conditions.</p><Link to={`/alerts?event=${eventId}`}>View collision alerts</Link></div>}
      <div className="list">{sorted.map(suggestion => {
        const status = suggestion.status || (suggestion.isAccepted ? 'approved' : 'pending');
        const expired = !!suggestion.expiresAt && suggestion.expiresAt.toMillis() <= now;
        const pending = status === 'pending' && !expired;
        const linkedIncident = !!suggestion.groupId && !!suggestion.alertId && !!suggestion.incidentId;
        const groupIds = [...new Set([...(suggestion.groupId ? [suggestion.groupId] : []), ...(suggestion.groupIds ?? [])])];
        const groupNames = groupIds.map(id => groups.items.find(group => group.id === id)?.name ?? id);
        const kind = kindById[suggestion.id] ?? suggestionKind(suggestion);
        const instruction = textById[suggestion.id] ?? suggestionInstruction(suggestion);
        const validInstruction = instruction.trim().length > 0 && instruction.trim().length <= 500;
        return <article key={suggestion.id} className="panel"><h2>{groupNames.join(', ') || 'Affected group'} <span className="badge">{expired && status === 'pending' ? 'expired' : status}</span></h2>
          {suggestion.sourceType && <p>Source: {suggestion.sourceType}</p>}
          <p>{suggestion.reason || suggestion.rationale || suggestion.message || 'No rationale provided.'}</p>
          {(suggestion.kind || suggestion.action) && <p>Suggested action: {(suggestion.kind || suggestion.action)?.replaceAll('_', ' ')}</p>}
          {suggestion.instruction && !(pending && linkedIncident) && <p><strong>Instruction:</strong> {suggestion.instruction}</p>}
          {!!suggestion.suggestedRouteSegmentIds?.length && <p>Suggested segments: {suggestion.suggestedRouteSegmentIds.join(', ')}</p>}
          <p className="subtle">Created {suggestion.createdAt?.toDate().toLocaleString() ?? 'recently'}{suggestion.expiresAt ? ` · Expires ${suggestion.expiresAt.toDate().toLocaleString()}` : ''}{suggestion.decidedAt ? ` · Decided ${suggestion.decidedAt.toDate().toLocaleString()}` : ''}</p>
          {pending && linkedIncident && <>
            <label>Admin-selected action<select disabled={!!busyId} value={kind} onChange={e => setKindById(values => ({ ...values, [suggestion.id]: e.target.value }))}>{kinds.map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
            <label>Instruction to leader<textarea disabled={!!busyId} maxLength={500} value={instruction} onChange={e => setTextById(values => ({ ...values, [suggestion.id]: e.target.value }))} /></label>
            <p className="subtle">Enter 1–500 characters. Approval sends this instruction; it does not change route geometry or stop requirements.</p>
            <div className="actions"><button disabled={!!busyId || !validInstruction} onClick={() => void decide(suggestion, 'approved')}>{busyId === suggestion.id ? 'Submitting…' : 'Approve and notify leader'}</button><button disabled={!!busyId} onClick={() => void decide(suggestion, 'rejected')}>Reject</button></div>
          </>}
          {pending && !linkedIncident && <p className="subtle">This legacy advice is read-only. Ask an event manager to regenerate advice for the current incident before approving an instruction.</p>}
          <Link to={`/live-map?event=${eventId}`}>Inspect event map</Link>
        </article>;
      })}</div>
    </section>}
    {error && <p className="error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </div>;
}
