import { useState } from 'react';
import { callManagement } from './management';
import { createResourceWriter, type Resource } from './management_requests';

export function useResourceWriter(resource: Resource, eventId: string, existingId?: string) {
  const [write] = useState(() => createResourceWriter(resource, eventId, existingId ?? crypto.randomUUID(), !!existingId,
    request => callManagement('manageEvent', request)));
  return write;
}
