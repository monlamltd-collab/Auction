// lib/pipeline/description-extract-worker.js
//
// Worker-thread wrapper around extractDescriptionParas, one worker per HTML
// batch. jsdom@24 retains ~1.5MB of heap PER PARSE even after window.close()
// (measured 2026-07-23: 1,000 sequential parses → 1.5GB heapUsed, mark-compacts
// unable to reclaim) — enough that the 07:00 narrative sweep OOM-killed the
// whole prod process daily. Parsing inside a short-lived worker makes the leak
// irrelevant: the worker exits after its batch and the OS reclaims everything.
//
// Contract: workerData = { htmls: string[] } → postMessage(string[][]) — one
// paragraph array per input, same order. Used by narrative-sweep.js via
// extractParasBatchIsolated().

import { parentPort, workerData } from 'worker_threads';
import { extractDescriptionParas } from './description-extract.js';

const out = (workerData?.htmls || []).map(html => {
  try { return extractDescriptionParas(html); } catch { return []; }
});
parentPort.postMessage(out);
