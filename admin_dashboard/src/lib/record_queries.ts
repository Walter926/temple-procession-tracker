export type RecordOrder = { field: string; direction: 'asc' | 'desc' };
export type RecordFilter = { field: string; value: string };
export type RecordsOptions = { status?: string };
export type RecordsPlan = { collectionName: string; filters: RecordFilter[]; order: RecordOrder[]; pageSize: number; enabled: boolean; key: string };

// Only server-authored feeds require createdAt. Legacy planning records and
// profiles may have no timestamps; ordering those by createdAt silently hides them.
const recentFeeds = new Set(['accessCodes', 'announcements', 'arrivalNotifications', 'collisionAlerts', 'routeSuggestions']);
const eventCollections = new Set(['groups', 'routes', 'groupProgress', ...recentFeeds]);
const routeCollections = new Set(['stopPoints', 'routeSegments']);

export function recordsPlan(collectionName: string, session: { uid?: string; role: string | null; isActive: boolean },
  requestedField?: string, requestedEquals?: string, options: RecordsOptions = {}): RecordsPlan {
  const filters: RecordFilter[] = [];
  let enabled = !!session.uid && session.isActive && ['admin', 'organizer'].includes(session.role ?? '');
  if (requestedField) {
    if (!requestedEquals) enabled = false; // Never turn an empty selector into a collection-wide read.
    else filters.push({ field: requestedField, value: requestedEquals });
  }
  if (collectionName === 'events' && session.role !== 'admin') {
    if (requestedField === 'organizerId' && requestedEquals !== session.uid) enabled = false;
    if (requestedField !== 'organizerId') filters.push({ field: 'organizerId', value: session.uid ?? '' });
  }
  if (collectionName === 'users' && session.role !== 'admin') enabled = false;
  if (eventCollections.has(collectionName) && (requestedField !== 'eventId' || !requestedEquals)) enabled = false;
  if (routeCollections.has(collectionName) && (requestedField !== 'routeId' || !requestedEquals)) enabled = false;
  if (options.status) filters.push({ field: 'status', value: options.status });
  const direction = recentFeeds.has(collectionName) ? 'desc' : 'asc';
  const order: RecordOrder[] = recentFeeds.has(collectionName) ? [{ field: 'createdAt', direction }] : [];
  // Explicit tie-breaker is also the cursor order for timestamp-free collections.
  order.push({ field: '__name__', direction });
  const plan = { collectionName, filters, order, pageSize: 200, enabled };
  return { ...plan, key: JSON.stringify([session.uid, session.role, session.isActive, plan]) };
}
