import { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { type Timestamp } from 'firebase/firestore';
import { firebaseApp } from '../lib/firebase';
import { useRecords } from '../lib/records';
import type { EventRecord } from '../types/domain';

type Suggestion = { id: string; eventId: string; groupIds: string[]; sourceType: string; kind: string; status: string; rationale: string; createdAt: Timestamp };
const kinds = ['wait_at_current_stop', 'delay_departure', 'proceed_to_next_checkpoint', 'use_alternate_route', 'skip_optional_stop'];
export default function RouteSuggestionsPage() {
  const events = useRecords<EventRecord>('events'), suggestions = useRecords<Suggestion>('routeSuggestions');
  const [eventId, setEventId] = useState(''), [kindById, setKindById] = useState<Record<string, string>>({}), [textById, setTextById] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  async function decide(item: Suggestion, decision: 'approve' | 'ignore') {
    setBusy(item.id); setError('');
    try {
      await httpsCallable(getFunctions(firebaseApp, 'us-central1'), 'decideRouteSuggestion')({ suggestionId: item.id, decision, kind: kindById[item.id] || item.kind, instruction: (textById[item.id] ?? item.rationale).slice(0, 500) });
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  }
  return <div><h1>Route Suggestions</h1><section className="panel"><label>Event<select value={eventId} onChange={e => setEventId(e.target.value)}><option value="">All events</option>{events.items.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label></section>
    {suggestions.error && <p className="error">{suggestions.error}</p>}{error && <p role="alert" className="error">{error}</p>}
    {suggestions.items.filter(s => !eventId || s.eventId === eventId).map(s => <section key={s.id} className="panel"><h3>{s.sourceType} · {s.status}</h3><p>{s.rationale}</p><p>Groups: {s.groupIds.join(', ')} · {s.createdAt?.toDate?.().toLocaleString() ?? 'Pending'}</p>
      {s.status === 'pending' && <><label>Admin-selected action<select value={kindById[s.id] || s.kind} onChange={e => setKindById(p => ({ ...p, [s.id]: e.target.value }))}>{kinds.map(k => <option key={k} value={k}>{k.replaceAll('_', ' ')}</option>)}</select></label>
        <label>Instruction to leader<textarea maxLength={500} value={textById[s.id] ?? s.rationale} onChange={e => setTextById(p => ({ ...p, [s.id]: e.target.value }))} /></label>
        <button disabled={busy === s.id} onClick={() => void decide(s, 'approve')}>Approve and Send</button> <button disabled={busy === s.id} onClick={() => void decide(s, 'ignore')}>Ignore</button></>}
    </section>)}
  </div>;
}