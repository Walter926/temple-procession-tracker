import { initializeApp } from 'firebase-admin/app';
import { setGlobalOptions } from 'firebase-functions/v2';

initializeApp();
setGlobalOptions({ maxInstances: 10, region: 'us-central1' });

export { createAccessCode, revokeAccessCode, redeemAccessCode } from './access_codes';
export { mirrorGroupAssignment, mirrorEventState } from './tracking_mirrors';
export { mirrorGroupStatus } from './group_status_mirrors';