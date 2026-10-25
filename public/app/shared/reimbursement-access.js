import { getSessionState } from '../core/api.js';
export const reimbursementsEnabled = () => getSessionState().user?.localPreview === true
  || getSessionState().user?.reimbursementsEnabled === true;
export const reimbursementApiRoot = () => getSessionState().user?.localPreview === true
  ? '/api/preview/reimbursements' : '/api/reimbursements';
