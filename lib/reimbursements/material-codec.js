import { createHash } from 'node:crypto';
import { STATE_MAPS } from './state.js';
export const checksum = value => createHash('sha256').update(value).digest('hex');
const materialReference = Symbol('private-material-reference');
export function storageFailure(code = 'reimbursement_storage_unavailable') {
  return Object.assign(new Error('报销存储暂时不可用，请保留材料并稍后重试。'), { statusCode: 503, code });
}
export const emptyDocument = () => ({ format: 1, storedBytes: 0, maps: Object.fromEntries(STATE_MAPS.map(name => [name, []])) });
function validReference(value) {
  const ref = value?.$material;
  return ref && Object.keys(value).length === 1 && /^[a-f0-9]{64}$/.test(ref.sha256)
    && Number.isSafeInteger(ref.size) && ref.size >= 0 && ref.size <= 100 * 1024 ** 2
    && typeof ref.path === 'string' && (ref.size > 0 ? ref.path.length > 0 : ref.sha256 === checksum(Buffer.alloc(0)));
}
export function createMaterialCodec(files) {
  const cache = new Map(); let cachedBytes = 0;
  function decode(value) {
    if (!value || typeof value !== 'object') return value;
    const result = Array.isArray(value) ? [] : {};
    for (const [key, item] of Object.entries(value)) {
      if (item && typeof item === 'object' && '$material' in item && !validReference(item)) throw storageFailure('reimbursement_state_corrupt');
      if (validReference(item)) {
        const get = () => {
          const ref = item.$material;
          if (!ref.size) return Buffer.alloc(0);
          if (cache.has(ref.sha256)) return cache.get(ref.sha256);
          throw Object.assign(storageFailure('reimbursement_material_needed'), { material: ref });
        };
        get[materialReference] = item;
        Object.defineProperty(result, key, { get, enumerable: true });
      } else Object.defineProperty(result, key, { value: decode(item), writable: true, configurable: true, enumerable: true });
    }
    return result;
  }
  function restore(state, document) {
    if (document?.format !== 1 || !Number.isSafeInteger(document.storedBytes) || document.storedBytes < 0
      || STATE_MAPS.some(name => !Array.isArray(document.maps?.[name]) && !(name === 'notificationJobs' && document.maps?.[name] === undefined))) throw storageFailure('reimbursement_state_corrupt');
    state.storedBytes = document.storedBytes;
    for (const name of STATE_MAPS) {
      state[name].clear();
      for (const entry of document.maps[name] || []) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || state[name].has(entry[0])) throw storageFailure('reimbursement_state_corrupt');
        state[name].set(entry[0], decode(entry[1]));
      }
    }
  }
  async function encodeState(state) {
    const pending = new Map();
    function encode(value) {
      if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
        const sha256 = checksum(value), ref = { sha256, size: value.length, path: '' };
        if (!pending.has(sha256)) pending.set(sha256, { bytes: Buffer.from(value), refs: [] });
        pending.get(sha256).refs.push(ref); return { $material: ref };
      }
      if (!value || typeof value !== 'object') return value;
      const result = Array.isArray(value) ? [] : {};
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!descriptor.enumerable) continue;
        Object.defineProperty(result, key, { value: descriptor.get?.[materialReference] || encode(descriptor.value), enumerable: true, writable: true });
      }
      return result;
    }
    const document = { format: 1, storedBytes: state.storedBytes,
      maps: Object.fromEntries(STATE_MAPS.map(name => [name, [...state[name]].map(([key, value]) => [key, encode(value)])])) };
    for (const [sha256, item] of pending) {
      if (!item.bytes.length) continue;
      let ref;
      try { ref = await files.put({ sha256, bytes: item.bytes }); } catch { throw storageFailure('reimbursement_box_save_failed'); }
      if (!validReference({ $material: ref }) || ref.sha256 !== sha256 || ref.size !== item.bytes.length || !ref.path) throw storageFailure('reimbursement_box_save_failed');
      for (const target of item.refs) Object.assign(target, ref);
    }
    return document;
  }
  async function fetchMaterial(ref) {
    if (cache.has(ref.sha256)) return;
    if (cachedBytes + ref.size > 220 * 1024 ** 2) throw storageFailure('reimbursement_material_capacity');
    let bytes;
    try { bytes = Buffer.from(await files.read(ref)); } catch { throw storageFailure('reimbursement_box_read_failed'); }
    if (bytes.length !== ref.size || checksum(bytes) !== ref.sha256) throw storageFailure('reimbursement_material_corrupt');
    cache.set(ref.sha256, bytes); cachedBytes += bytes.length;
  }
  return { restore, encodeState, fetchMaterial, clear: () => { cache.clear(); cachedBytes = 0; } };
}
