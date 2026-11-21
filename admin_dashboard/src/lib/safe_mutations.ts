import { deleteResource } from './management';
export const deleteDraftRoute = (eventId: string, routeId: string) => deleteResource('route', eventId, routeId);
export const deleteDraftStop = (eventId: string, _routeId: string, stopId: string) => deleteResource('stop', eventId, stopId);
export const deleteDraftGroup = (eventId: string, groupId: string) => deleteResource('group', eventId, groupId);
