import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Timestamp } from 'firebase/firestore';
import { useManagedEvents, useRecords } from '../lib/records';
import { callManagement, errorMessage } from '../lib/management';
import QueryFeedback from '../components/QueryFeedback';
import type { GroupRecord } from '../types/domain';

interface Suggestion { id: string; eventId: string; groupId: string; reason: string; status?: string; isAccepted?: boolean; suggestedRouteSegmentIds?: string[]; createdAt?: Timestamp; expiresAt?: Timestamp; decidedAt?: Timestamp; incidentId?: string; instruction?: string; action?: string }
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
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(timer); }, []);
  async function decide(suggestion: Suggestion, decision: 'approved' | 'rejected') {
    setBusyId(suggestion.id); setError(''); setNotice('');
    try {
      const result = await callManagement<{ suggestionId: string; decision: string }, { status: string; alreadyDecided?: boolean }>('decideRouteSuggestion', { suggestionId: suggestion.id, decision });
      setNotice(result.alreadyDecided ? `This suggestion was already ${result.status}.` : result.status === 'approved' ? 'Suggestion approved. The server has queued the instruction for the assigned leader.' : `Suggestion ${result.status}.`);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusyId(''); }
  }
  const sorted = [...suggestions.items].sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
  return <div><h1>Route suggestions</h1><p className="subtle">Review collision advice for your events. Approval sends an instruction to the current affected leader, not a geometry change.</p>
    <section className="panel"><label>Event<select value={eventId} onChange={e => { setParams(e.target.value ? { event: e.target.value } : {}); setNotice(''); setError(''); }}><option value="">Choose an event</option>{events.items.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label><QueryFeedback state={events} /></section>
    {eventId && <section className="panel"><label>Advice<select value={adviceFilter} onChange={e => setAdviceFilter(e.target.value)}><option value="pending">Pending decisions</option><option value="">All advice and history</option></select></label><QueryFeedback state={suggestions} /><QueryFeedback state={groups} />
      {!suggestions.loading && !suggestions.error && !sorted.length && <div className="empty-state"><h2>No route advice to review</h2><p>Suggestions appear when a fresh active collision needs operator coordination. Check the live map or collision alerts for current conditions.</p><Link to={`/alerts?event=${eventId}`}>View collision alerts</Link></div>}
      <div className="list">{sorted.map(suggestion => {
        const status = suggestion.status || (suggestion.isAccepted ? 'approved' : 'pending');
        const expired = !!suggestion.expiresAt && suggestion.expiresAt.toMillis() <= now;
        const pending = status === 'pending' && !expired;
        return <article key={suggestion.id} className="panel"><h2>{groups.items.find(g => g.id === suggestion.groupId)?.name ?? 'Affected group'} <span className="badge">{expired && status === 'pending' ? 'expired' : status}</span></h2>
          <p>{suggestion.reason}</p>{suggestion.instruction && <p><strong>Proposed instruction:</strong> {suggestion.instruction}</p>}
          {!!suggestion.suggestedRouteSegmentIds?.length && <p>Suggested segments: {suggestion.suggestedRouteSegmentIds.join(', ')}</p>}
          <p className="subtle">Created {suggestion.createdAt?.toDate().toLocaleString() ?? 'recently'}{suggestion.expiresAt ? ` · Expires ${suggestion.expiresAt.toDate().toLocaleString()}` : ''}</p>
          {pending && <div className="actions"><button disabled={!!busyId} onClick={() => void decide(suggestion, 'approved')}>{busyId === suggestion.id ? 'Submitting…' : 'Approve and notify leader'}</button><button disabled={!!busyId} onClick={() => void decide(suggestion, 'rejected')}>Reject</button></div>}
          <Link to={`/live-map?event=${eventId}`}>Inspect event map</Link>
        </article>;
      })}</div>
    </section>}
    {error && <p className="error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </div>;
}
