import { useState, type FormEvent } from 'react';
import { errorMessage } from '../lib/management';
import { useResourceWriter } from '../lib/useResourceWriter';
import { createSingleFlight } from '../lib/management_requests';
import { eventFieldErrors, type FieldErrors } from '../lib/validation';
import FieldError from '../components/FieldError';
import { dateTimeLocal, parseLocalDateTime } from '../lib/event_dates';
import type { EventRecord, EventStatus } from '../types/domain';

const statuses: EventStatus[] = ['draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled', 'archived'];
interface Props { initial?: EventRecord; initialContacts?: { organizerContact: string; emergencyContact: string }; onSaved: (id: string) => void; onCancel: () => void }

export default function EventForm({ initial, initialContacts, onSaved, onCancel }: Props) {
  const write = useResourceWriter('event', initial?.id ?? '', initial?.id);
  const [flight] = useState(createSingleFlight);
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [start, setStart] = useState(dateTimeLocal(initial?.startTime));
  const [end, setEnd] = useState(dateTimeLocal(initial?.endTime));
  const [mainTempleName, setMainTempleName] = useState(initial?.mainTempleName ?? '');
  const [cityRegion, setCityRegion] = useState(initial?.cityRegion ?? '');
  const [isPublic, setIsPublic] = useState(initial?.isPublic ?? false);
  const [organizerContact, setOrganizerContact] = useState(initialContacts?.organizerContact ?? '');
  const [emergencyContact, setEmergencyContact] = useState(initialContacts?.emergencyContact ?? '');
  const [status, setStatus] = useState<EventStatus>(initial?.status ?? 'draft');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); event.stopPropagation();
    const validation = eventFieldErrors({ name, description, start, end, mainTempleName, cityRegion, organizerContact, emergencyContact, status }, initial?.status);
    setErrors(validation);
    if (Object.keys(validation).length || !flight.start()) return;
    const startTimeMs = parseLocalDateTime(start), endTimeMs = end ? parseLocalDateTime(end) : null;
    setBusy(true); setError('');
    try {
      const id = await write({
        name: name.trim(), description: description.trim(), status, startTimeMs, endTimeMs,
        mainTempleName: mainTempleName.trim(), cityRegion: cityRegion.trim(), isPublic,
        organizerContact: organizerContact.trim(), emergencyContact: emergencyContact.trim(),
      });
      onSaved(id);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { flight.finish(); setBusy(false); }
  }
  return <form className="panel" noValidate onSubmit={save}><h2>{initial ? 'Edit event' : 'Create event'}</h2><fieldset disabled={busy}><div className="form-grid">
    <label>Name *<input name="eventName" required aria-invalid={!!errors.eventName} aria-describedby="eventName-error" maxLength={120} value={name} onChange={e => setName(e.target.value)} /><FieldError name="eventName" errors={errors} /></label>
    <label>Status<select name="eventStatus" value={status} onChange={e => setStatus(e.target.value as EventStatus)}>{(initial ? statuses.filter(s => !['completed', 'cancelled', 'archived'].includes(initial.status) || s === initial.status || s === 'archived') : ['draft']).map(s => <option key={s} value={s}>{s}</option>)}</select><FieldError name="eventStatus" errors={errors} /></label>
    <label className="span-2">Description<textarea name="eventDescription" maxLength={4000} value={description} onChange={e => setDescription(e.target.value)} /><FieldError name="eventDescription" errors={errors} /></label>
    <label>Start time *<input name="startTime" required aria-invalid={!!errors.startTime} aria-describedby="startTime-error" type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /><FieldError name="startTime" errors={errors} /></label>
    <label>End time<input name="endTime" aria-invalid={!!errors.endTime} aria-describedby="endTime-error" type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} /><FieldError name="endTime" errors={errors} /></label>
    <label>Main temple *<input name="mainTempleName" required aria-invalid={!!errors.mainTempleName} aria-describedby="mainTempleName-error" maxLength={120} value={mainTempleName} onChange={e => setMainTempleName(e.target.value)} /><FieldError name="mainTempleName" errors={errors} /></label>
    <label>City or region *<input name="cityRegion" required aria-invalid={!!errors.cityRegion} aria-describedby="cityRegion-error" maxLength={120} value={cityRegion} onChange={e => setCityRegion(e.target.value)} /><FieldError name="cityRegion" errors={errors} /></label>
    <label>Organizer contact (private)<input name="organizerContact" maxLength={200} value={organizerContact} onChange={e => setOrganizerContact(e.target.value)} /><FieldError name="organizerContact" errors={errors} /></label>
    <label>Emergency contact (private)<input name="emergencyContact" maxLength={200} value={emergencyContact} onChange={e => setEmergencyContact(e.target.value)} /><FieldError name="emergencyContact" errors={errors} /></label>
    <label className="inline span-2"><input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} /> Visible on the public map when scheduled or active</label>
    </div></fieldset><p className="subtle">Scheduling and activation validate routes, stops, groups and leaders on the server. Private contacts are never published.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="actions"><button disabled={busy}>{busy ? 'Saving…' : 'Save event'}</button><button type="button" disabled={busy} onClick={onCancel}>Cancel</button></div>
  </form>;
}
