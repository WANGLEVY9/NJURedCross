import { Base } from 'seatable-api';
import { createSeaTableAccess } from '../seatable-auth.js';
import { storageFailure } from './material-codec.js';
import { REIMBURSEMENT_BOX_DIRECTORY } from './box-directory.js';
export function reimbursementReviewerBindings(env = process.env) {
  return { 'initial-suzhou': env.REIMBURSEMENT_INITIAL_SUZHOU_ACCOUNT_ID || '',
    'initial-other': env.REIMBURSEMENT_INITIAL_OTHER_ACCOUNT_ID || '', final: env.REIMBURSEMENT_FINAL_ACCOUNT_ID || '' };
}

export function reimbursementConfiguration(env = process.env) {
  return { enabled: env.PLATFORM_REIMBURSEMENTS_ENABLED === 'true', allowWrites: env.PLATFORM_REIMBURSEMENTS_ALLOW_WRITES === 'true',
    table: { server: env.SEATABLE_REIMBURSEMENTS_SERVER_URL || 'https://table.nju.edu.cn',
      token: env.SEATABLE_REIMBURSEMENTS_API_TOKEN || '', uuid: env.SEATABLE_REIMBURSEMENTS_BASE_UUID || '' },
    box: { server: env.NJUBOX_REIMBURSEMENTS_SERVER_URL || 'https://box.nju.edu.cn',
      token: env.NJUBOX_REIMBURSEMENTS_TOKEN || '', repoId: env.NJUBOX_REIMBURSEMENTS_REPO_ID || '',
      directory: env.NJUBOX_REIMBURSEMENTS_DIR || REIMBURSEMENT_BOX_DIRECTORY } };
}
export function configuredReimbursementStorage(config) {
  return { tableConfigured: Boolean(config.table?.token && config.table?.uuid), boxConfigured: Boolean(config.box?.token),
    writeEnabled: config.allowWrites === true, enabled: config.enabled === true };
}
export function reimbursementConnection(config) {
  let access;
  return async () => {
    if (!config.token || !config.uuid) throw storageFailure('reimbursement_table_not_configured');
    access ||= createSeaTableAccess(new Base({ server: config.server, APIToken: config.token }));
    const client = await access();
    if (client.dtableUuid !== config.uuid) throw storageFailure('reimbursement_base_mismatch');
    return client;
  };
}
