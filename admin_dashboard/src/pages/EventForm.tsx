import { useState, type FormEvent } from 'react';
import { collection, deleteField, doc, Timestamp, writeBatch } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useSession } from '../context/AuthContext';
import type { EventRecord, EventStatus } from '../types/domain';

const statuses: EventStatus[] = ['draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled', 'archived'];

const datetimeLocal = (time: Timestamp | null | undefined) => {
  if (!time) return '';
  const d = time.toDate();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

interface Props { initial?: EventRecord; initialContacts?: { organizerContact: string; emergencyContact: string }; onSaved: (id: string) => void; onCancel: () => void }

export default function EventForm({ initial, initialContacts, onSaved, onCancel }: Props) {
  const { user } = useSession();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [start, setStart] = useState(datetimeLocal(initial?.startTime));
  const [end, setEnd] = useState(datetimeLocal(initial?.endTime));
  const [mainTempleName, setMainTempleName] = useState(initial?.mainTempleName ?? '');
  const [cityRegion, setCityRegion] = useState(initial?.cityRegion ?? '');
  const [isPublic, setIsPublic] = useState(initial?.isPublic ?? false);
  const [organizerContact, setOrganizerContact] = useState(initialContacts?.organizerContact ?? '');
  const [emergencyContact, setEmergencyContact] = useState(initialContacts?.emergencyContact ?? '');
  const [status, setStatus] = useState<EventStatus>(initial?.status ?? 'draft');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) { setError('You must be signed in.'); return; }
    if (!name.trim() || !mainTempleName.trim() || !cityRegion.trim() || !start) { setError('Complete the required fields.'); return; }
    if (end && new Date(end).getTime() <= new Date(start).getTime()) { setError('End time must be after start time.'); return; }

    setBusy(true);
    setError('');

    try {
      const now = Timestamp.now();
      const eventRef = initial ? doc(db, 'events', initial.id) : doc(collection(db, 'events'));
      const value = {
        name: name.trim(), description: description.trim(), status,
        startTime: Timestamp.fromDate(new Date(start)), endTime: end ? Timestamp.fromDate(new Date(end)) : null,
        mainTempleName: mainTempleName.trim(), cityRegion: cityRegion.trim(), isPublic, updatedAt: now,
      };

      const batch = writeBatch(db);
      if (initial) batch.update(eventRef, { ...value, organizerContact: deleteField(), emergencyContact: deleteField() });
      else batch.set(eventRef, { ...value, organizerId: user.uid, routeId: null, createdAt: now });

      batch.set(doc(db, 'eventContacts', eventRef.id), {
        organizerContact: organizerContact.trim(), emergencyContact: emergencyContact.trim(), updatedAt: now,
      });

      const publicRef = doc(db, 'publicEvents', eventRef.id);
      if (isPublic && (status === 'scheduled' || status === 'active')) {
        batch.set(publicRef, {
          name: name.trim(), cityRegion: cityRegion.trim(), mainTempleName: mainTempleName.trim(),
          startTime: Timestamp.fromDate(new Date(start)), status, routeId: initial?.routeId ?? null, isPublic: true,
        });
      } else {
        batch.delete(publicRef);
      }

      await batch.commit();
      onSaved(eventRef.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save event.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={save}>
      <h2>{initial ? 'Edit Event' : 'Create Event'}</h2>
      <div className="form-grid">
        <label>Name *<input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Status<select value={status} onChange={(e) => setStatus(e.target.value as EventStatus)}>{statuses.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        <label className="span-2">Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <label>Event date and start time *<input required type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label>Estimated end time<input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <label>Main temple *<input required value={mainTempleName} onChange={(e) => setMainTempleName(e.target.value)} /></label>
        <label>City or region *<input required value={cityRegion} onChange={(e) => setCityRegion(e.target.value)} /></label>
        <label>Organizer contact<input value={organizerContact} onChange={(e) => setOrganizerContact(e.target.value)} /></label>
        <label>Emergency contact<input value={emergencyContact} onChange={(e) => setEmergencyContact(e.target.value)} /></label>
        <label className="inline span-2"><input type="checkbox" style={{ width: 'auto' }} checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /> Visible to public map users</label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button disabled={busy} type="submit">{busy ? 'Saving...' : 'Save Event'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}