import { parentPort, workerData } from 'node:worker_threads';
import { generateItemPackets } from './item-packets.js';
try { parentPort.postMessage({ ok: true, packets: await generateItemPackets(workerData) }); }
catch { parentPort.postMessage({ ok: false }); }
