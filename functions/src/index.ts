import { initializeApp } from 'firebase-admin/app';
import { setGlobalOptions } from 'firebase-functions/v2';

initializeApp();
setGlobalOptions({ maxInstances: 10, region: 'us-central1' });

export { createAccessCode, revokeAccessCode, redeemAccessCode, cleanupExpiredAccessCodes } from './access_codes';
export { mirrorGroupAssignment, mirrorEventState, mirrorAccountState, mirrorMembershipAccess, reconcileTrackingMirrors } from './tracking_mirrors';
export { mirrorGroupStatus } from './group_status_mirrors';
export { detectStopArrival } from './stop_arrival';
export { updateRouteProgress } from './route_progress';

export { detectGroupCollision, reconcileGroupCollisions } from './collision_detection';

export { mirrorCollisionAlert } from './collision_alert_mirror';

export { resolveCollisionAlert, sendCollisionInstruction, acknowledgeCollisionWarning } from './alert_actions';
export { assignGroupLeader, listAssignableLeaders, manageAccount, cleanupDeletedAccounts } from './account_management';
export { manageEvent, validateEvent, deleteEvent, deleteGroup, deleteRoute, deleteStopPoint, mirrorPublicEvent, mirrorPublicRoute, reconcilePublicEvents } from './event_management';
export { setActiveMembership, removeMembership, transferMembership } from './memberships';
export { registerDeviceToken, unregisterDeviceToken, markNotificationRead, sendAnnouncement, fanoutAnnouncement, continueAnnouncementFanout, deliverNotificationOnCreate, retryNotificationDeliveries } from './notifications';
export { decideRouteSuggestion, approveRouteSuggestion, rejectRouteSuggestion, acknowledgeRouteInstruction, generateRouteSuggestions } from './route_suggestions';
export { reconcileTrackingHeartbeats, expireOperationalMessages, cleanupRetention, registerLiveLocationRetention, discoverLiveLocationRetention } from './maintenance';
