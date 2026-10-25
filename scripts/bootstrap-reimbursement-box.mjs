import { reimbursementConfiguration } from '../lib/reimbursements/config.js';
import { prepareReimbursementBoxDirectory } from '../lib/reimbursements/box-directory.js';

// Only the named reimbursement folder; no other modules' tokens or bootstrap.
try {
  const apply = process.argv.includes('--apply');
  const report = await prepareReimbursementBoxDirectory(reimbursementConfiguration().box, { apply });
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const code = /^reimbursement_box_[a-z_]+$/.test(error.code) ? error.code : 'reimbursement_box_setup_failed';
  console.error(JSON.stringify({ code })); process.exitCode = 1;
}
