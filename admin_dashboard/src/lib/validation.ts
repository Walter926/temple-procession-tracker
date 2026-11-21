import { decodePolyline, pathDistanceMeters, validPoint } from './polyline.ts';
import { parseLocalDateTime } from './event_dates.ts';

export type FieldErrors = Record<string, string>;
export function routeFieldErrors(value: { name: string; description: string; color: string; encoded: string; duration: string }): FieldErrors {
  const errors: FieldErrors = {};
  if (!value.name.trim() || value.name.trim().length > 120) errors.routeName = 'Route name must contain 1–120 characters.';
  if (value.description.trim().length > 4000) errors.routeDescription = 'Description must be at most 4000 characters.';
  if (!/^#[0-9a-f]{6}$/i.test(value.color)) errors.routeColor = 'Choose a six-digit hex color.';
  const geometry = validateRoute(value.encoded, 0);
  if (geometry) errors.routeGeometry = geometry;
  if (!value.duration.trim() || !Number.isFinite(Number(value.duration)) || Number(value.duration) < 0 || Number(value.duration) > 10080) errors.routeDuration = 'Duration must be 0–10080 minutes.';
  return errors;
}

export function eventFieldErrors(value: { name: string; description: string; start: string; end: string; mainTempleName: string; cityRegion: string; organizerContact: string; emergencyContact: string; status: string }, initialStatus?: string): FieldErrors {
  const errors: FieldErrors = {};
  for (const [field, text, label] of [['eventName', value.name, 'Event name'], ['mainTempleName', value.mainTempleName, 'Main temple'], ['cityRegion', value.cityRegion, 'City or region']]) {
    if (!text.trim() || text.trim().length > 120) errors[field] = `${label} must contain 1–120 characters.`;
  }
  if (value.description.trim().length > 4000) errors.eventDescription = 'Description must be at most 4000 characters.';
  if (!Number.isFinite(parseLocalDateTime(value.start))) errors.startTime = 'Enter a valid start time.';
  if (value.end && (!Number.isFinite(parseLocalDateTime(value.end)) || parseLocalDateTime(value.end) <= parseLocalDateTime(value.start))) errors.endTime = 'End time must be after start time.';
  if (!initialStatus && value.status !== 'draft') errors.eventStatus = 'Create a draft before adding routes, stops and groups.';
  if (initialStatus && ['completed', 'cancelled', 'archived'].includes(initialStatus) && value.status !== initialStatus && value.status !== 'archived') errors.eventStatus = 'Closed events cannot be reactivated.';
  for (const key of ['organizerContact', 'emergencyContact'] as const) if (value[key].trim().length > 200) errors[key] = 'Contact must be at most 200 characters.';
  return errors;
}

export function validateRoute(encoded: string, minutes: number): string {
  try {
    const points = decodePolyline(encoded);
    if (points.length < 2 || points.length > 2000 || pathDistanceMeters(points) < 1) return 'Draw 2–2000 distinct route points.';
  } catch { return 'Route geometry is invalid. Import a valid encoded route or redraw it.'; }
  return Number.isFinite(minutes) && minutes >= 0 && minutes <= 10080 ? '' : 'Duration must be 0–10080 minutes.';
}

export function validateStop(value: { latitude: number; longitude: number; order: number; radius: number; maxGroups: number }, occupiedOrders: number[]): string {
  if (!validPoint({ lat: value.latitude, lng: value.longitude })) return 'Choose valid stop coordinates.';
  if (!Number.isInteger(value.order) || value.order < 1 || value.order > 10000 || occupiedOrders.includes(value.order)) return 'Stop order must be a unique integer from 1–10000.';
  if (!Number.isFinite(value.radius) || value.radius < 5 || value.radius > 1000) return 'Geofence radius must be 5–1000 meters.';
  if (!Number.isInteger(value.maxGroups) || value.maxGroups < 1 || value.maxGroups > 100) return 'Stop capacity must be 1–100 groups.';
  return '';
}

export function stopFieldErrors(value: { name: string; description: string; latitude: string; longitude: string; order: string; radius: string; maxGroups: string; arrival: string; departure: string }, occupiedOrders: number[]): FieldErrors {
  const errors: FieldErrors = {};
  if (!value.name.trim() || value.name.trim().length > 120) errors.stopName = 'Stop name must contain 1–120 characters.';
  if (value.description.trim().length > 4000) errors.stopDescription = 'Description must be at most 4000 characters.';
  for (const [key, text, limit] of [['stopLatitude', value.latitude, 90], ['stopLongitude', value.longitude, 180]] as const) {
    if (!text.trim() || !Number.isFinite(Number(text)) || Math.abs(Number(text)) > limit) errors[key] = `Enter a coordinate between -${limit} and ${limit}.`;
  }
  const order = Number(value.order), radius = Number(value.radius), max = Number(value.maxGroups);
  if (!Number.isInteger(order) || order < 1 || order > 10000 || occupiedOrders.includes(order)) errors.stopOrder = 'Choose a unique order from 1–10000.';
  if (!Number.isFinite(radius) || radius < 5 || radius > 1000) errors.stopRadius = 'Geofence radius must be 5–1000 meters.';
  if (!Number.isInteger(max) || max < 1 || max > 100) errors.stopCapacity = 'Capacity must be 1–100 groups.';
  const arrival = parseLocalDateTime(value.arrival), departure = parseLocalDateTime(value.departure);
  if (value.arrival && !Number.isFinite(arrival)) errors.stopArrival = 'Enter a valid arrival time.';
  if (value.departure && !Number.isFinite(departure)) errors.stopDeparture = 'Enter a valid departure time.';
  if (Number.isFinite(arrival) && Number.isFinite(departure) && (departure < arrival || departure - arrival > 10080 * 60000)) errors.stopDeparture = 'Departure must be at or after arrival, within 10080 minutes.';
  return errors;
}

export function trackingLabel(state: string | undefined, updatedAt: number | undefined, recordedAt: number | undefined, now: number): string {
  if (!state) return 'Not started';
  if (state === 'paused' || state === 'stopped' || state === 'error') return state;
  if (!updatedAt || now - updatedAt > 45000 || updatedAt > now + 5000) return 'Disconnected';
  if (!recordedAt || now - recordedAt > 45000 || recordedAt > now + 5000) return 'GPS stale';
  return state;
}
