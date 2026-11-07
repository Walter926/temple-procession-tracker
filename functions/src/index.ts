import { initializeApp } from 'firebase-admin/app';
import { setGlobalOptions } from 'firebase-functions/v2';

initializeApp();
setGlobalOptions({ maxInstances: 10, region: 'us-central1' });

export { createAccessCode, revokeAccessCode, redeemAccessCode } from './access_codes';
export { mirrorGroupAssignment, mirrorEventState } from './tracking_mirrors';
export { mirrorGroupStatus } from './group_status_mirrors';
export { detectStopArrival } from './stop_arrival';
export { updateRouteProgress } from './route_progress';

export { detectGroupCollision, reconcileGroupCollisions } from './collision_detection';

export { mirrorCollisionAlert } from './collision_alert_mirror';

export { resolveCollisionAlert, sendCollisionInstruction, acknowledgeCollisionWarning } from './alert_actions';

export { suggestForCollision, suggestForDelay, decideRouteSuggestion } from './route_suggestions';

export { registerDeviceToken, markNotificationRead, notificationFromCollision, notificationFromRoute, notificationFromArrival, notificationFromDelay, notificationFromStoppedGps, notificationFromAnnouncement } from './notifications';

export { recordLocationHistory } from './location_history';