import { createMutationQueue } from '../events/safety.js';
import { createLocalReimbursementService } from './local-service.js';
import { createReimbursementState, TABLE_LIMITS } from './state.js';
import { createMaterialCodec } from './material-codec.js';
import { normalizeActivity } from './summary-contract.js';

export function createTableReimbursementService({ store, files, activityProvider, ...options }) {
  const state = createReimbursementState(), codec = createMaterialCodec(files), queue = createMutationQueue();
  let activitySnapshot = null;
  const service = createLocalReimbursementService({ ...options, state, limits: TABLE_LIMITS, local: false, apiRoot: '/api/reimbursements' });
  const wrap = (target, name, write = false) => (...args) => queue(async () => {
    if (write) { store.assertWritable(); files.assertConfigured(); }
    const previous = write ? await store.prepareWrite() : await store.load({ fresh: false });
    let catalogue;
    if (activityProvider && ['listActivities', 'saveActivity', 'submit', 'preview', 'create', 'review'].includes(name)) {
      const reused = !write && activitySnapshot && Date.now() - activitySnapshot.at < 5000;
      catalogue = reused ? activitySnapshot.rows : await activityProvider();
      if (!Array.isArray(catalogue) || catalogue.readMeta?.truncated) throw Object.assign(new Error('活动目录读取不完整。'), { statusCode: 503 });
      if (!reused) activitySnapshot = { at: Date.now(), rows: catalogue };
    }
    try {
      for (;;) {
        codec.restore(state, previous.document);
        for (const event of catalogue || []) {
          const id = String(event.eventId || event.id || ''); if (!id || !event.name) continue;
          const existing = state.activities.get(id); if (existing && !existing.catalogSource) continue;
          const date = event.startAt || event.date || '', parsed = Date.parse(date);
          const normalized = normalizeActivity({ name: event.name, location: event.location || '',
            campus: event.campus || '', date: Number.isFinite(parsed) ? new Date(parsed).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }) : '' });
          if (!existing || ['name', 'date', 'location', 'campus'].some(key => normalized[key] !== existing[key])) {
            state.activities.set(id, { ...normalized, id, catalogSource: true, revision: (existing?.revision || 0) + 1,
              updatedAt: new Date().toISOString() });
          }
        }
        let result;
        try { result = await target[name](...args); }
        catch (error) {
          if (error.code !== 'reimbursement_material_needed' || !error.material) throw error;
          await codec.fetchMaterial(error.material); continue;
        }
        if (write) {
          if (name === 'submit' && !result.duplicate) {
            const item = state.requests.get(result.request.id);
            item.applicantStudentId = args[0].studentId || ''; item.applicantEmail = args[0].email || '';
          }
          await store.commit(await codec.encodeState(state), previous);
        }
        return result && typeof result === 'object' && 'local' in result ? { ...result, local: false } : result;
      }
    } finally { codec.clear(); }
  });
  return {
    workflowInfo: actor => ({ ...service.workflowInfo(actor), persistent: true }),
    ...Object.fromEntries(['preprocess', 'submit', 'review', 'analyze', 'registerPayment'].map(name => [name, wrap(service, name, true)])),
    ...Object.fromEntries(['list', 'get', 'attachment'].map(name => [name, wrap(service, name)])),
    summaries: Object.fromEntries(['listActivities', 'saveActivity', 'preview', 'create', 'review', 'list', 'download', 'get']
      .map(name => [name, wrap(service.summaries, name, ['saveActivity', 'create', 'review'].includes(name))])),
    notifications: Object.fromEntries(['pending', 'prepare', 'attachment', 'finish'].map(name =>
      [name, wrap(service.notifications, name, ['prepare', 'finish'].includes(name))])),
    materialPackets: Object.fromEntries(['list', 'create', 'download'].map(name => [name, wrap(service.materialPackets, name, name === 'create')])),
    ledger: Object.fromEntries(['list', 'exportFile'].map(name => [name, wrap(service.ledger, name)])),
  };
}
