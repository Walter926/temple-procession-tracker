import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { managementError } from './management_errors';
import type { Resource } from './management_requests';

export async function callManagement<Request, Result = { id: string }>(name: string, request: Request): Promise<Result> {
  try { return (await httpsCallable<Request, Result>(functions, name)(request)).data; }
  catch (reason) {
    // Do not log request bodies: they can contain private contacts or access codes.
    if (import.meta.env.DEV) console.debug('Management callable failed', { endpoint: name, code: (reason as { code?: string })?.code });
    throw Error(managementError(reason, name), { cause: reason });
  }
}

export async function saveResource(resource: Resource, eventId: string, data: Record<string, unknown>, id?: string): Promise<string> {
  const result = await callManagement('manageEvent', { operation: id ? 'update' : 'create', resource, eventId, ...(id ? { id } : {}), data });
  return result.id;
}

export async function deleteResource(resource: Resource, eventId: string, id: string): Promise<void> {
  await callManagement('manageEvent', { operation: 'delete', resource, eventId, id });
}

export const errorMessage = managementError;
