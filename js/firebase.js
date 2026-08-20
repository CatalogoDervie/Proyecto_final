// firebase.js — Firestore connector seguro — Proyecto Final TIG
// ENTORNO DEMO AISLADO: este archivo bloquea explícitamente el Firebase real de producción.
import './pfc-storage.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection, doc, setDoc, getDocs, query, where,
  deleteDoc, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';
import { CLIENT_CONFIG } from './cliente-config.js';
import {
  PROGRAMMED_UNTIL_FIELD,
  argentinaDayKey,
  millisecondsUntilNextArgentinaDay,
  programadaHastaDia
} from './workflow-programada.js';

const firebaseConfig = CLIENT_CONFIG.firebase;
const EXPECTED_PROJECT_ID = 'proyecto-final-tig';
const BLOCKED_PRODUCTION_PROJECT_IDS = new Set(['cirugias-we']);
const configuredProjectId = String(firebaseConfig?.projectId || '').trim();
const isBlockedProductionProject = BLOCKED_PRODUCTION_PROJECT_IDS.has(configuredProjectId);
const isExpectedProject = configuredProjectId === EXPECTED_PROJECT_ID;
const isStorageIsolated = window.__PFC_STORAGE__?.ready === true;

// IMPORTANTE: aplicaciones alojadas bajo el mismo origen pueden compartir localStorage.
// La capa pfc-storage.js crea un espacio exclusivo para este Proyecto Final.
const QUEUE_KEY = 'pfc_demo_fsc_write_queue';
const CLINIC_A = 'clinica_a';
const CLINIC_B = 'clinica_b';
function clinicId(value) {
  const v = String(value || '').trim().toLowerCase();
  if (['clinica_a','cdu','clínica a','clinica a'].includes(v)) return CLINIC_A;
  if (['clinica_b','gualeguaychú','gualeguaychu','clínica b','clinica b'].includes(v)) return CLINIC_B;
  return '';
}
function profile() { return window.CURRENT_USER?.profile || {}; }
function role() { return String(profile().role || '').toLowerCase(); }
function canEditClinic(clinic) { return ['superadmin','supervisor'].includes(role()) || (role() === 'administrativo' && profile().clinica === clinic); }
function ownClinicCirugiasRef() {
  const c = clinicId(profile().clinica);
  return role() === 'administrativo' && c ? query(cirugiasRef, where('clinica', '==', c)) : cirugiasRef;
}
function programmedCirugiasRef() {
  return query(cirugiasRef, where(PROGRAMMED_UNTIL_FIELD, '>', argentinaDayKey()));
}
function queueLoad() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } }
function queueSave(q) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch(e) { console.warn('[PFC Queue] no se pudo persistir:', e.message); } }
function queueAdd(op) {
  const q = queueLoad();
  if (op.type === 'upsert') {
    const idx = q.findIndex(x => x.type === 'upsert' && String(x.row.id) === String(op.row.id));
    if (idx !== -1) { q[idx] = op; queueSave(q); return; }
  }
  q.push(op);
  queueSave(q);
}

let readyResolve;
const readyPromise = new Promise(r => { readyResolve = r; });
let app, db, auth, cirugiasRef, _initOk = false;

(async () => {
  try {
    if (!isStorageIsolated) {
      throw new Error('BLOQUEO DE SEGURIDAD PFC: no se pudo aislar el almacenamiento local del navegador.');
    }
    if (isBlockedProductionProject) {
      throw new Error('BLOQUEO DE SEGURIDAD PFC: no se permite conectar al proyecto Firebase de producción cirugias-we.');
    }
    if (!isExpectedProject) {
      throw new Error(`BLOQUEO DE SEGURIDAD PFC: el único proyecto Firebase permitido es ${EXPECTED_PROJECT_ID}.`);
    }
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
      })
    });
    cirugiasRef = collection(db, 'cirugias');
    _initOk = true;
    readyResolve(true);
  } catch(e) {
    console.warn('[Firebase PFC] entorno aislado sin conexión:', e.message);
    readyResolve(false);
  }
})();

function normVal(v) {
  if (v && typeof v.toDate === 'function') return v.toDate().toISOString().slice(0, 10);
  return v;
}
function normRow(raw, docId) {
  const row = {};
  for (const [k, v] of Object.entries(raw || {})) row[k] = normVal(v);
  row.id = String(row.id ?? docId ?? '');
  return row;
}
function sanitize(row) {
  const out = { ...row };
  const assigned = clinicId(out.clinica) || (role() === 'administrativo' ? clinicId(profile().clinica) : '');
  if (!assigned || !canEditClinic(assigned)) throw new Error('No tenés permisos para escribir en esta clínica.');
  out.clinica = assigned;
  const now = new Date().toISOString();
  out.id = String(out.id || '');
  out[PROGRAMMED_UNTIL_FIELD] = programadaHastaDia(out);
  if (!out.createdAt) out.createdAt = now;
  out.updatedAt = now;
  for (const k of Object.keys(out)) { if (out[k] === undefined) out[k] = null; }
  return out;
}
async function withRetry(fn, retries = 4, baseMs = 500) {
  let lastErr;
  for (let i = 1; i <= retries; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      if (i < retries) {
        const delay = baseMs * Math.pow(2, i - 1);
        console.warn(`[Firestore PFC] intento ${i}/${retries} → esperando ${delay}ms`, e.message);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

let _flushRunning = false;
async function flushQueue() {
  if (_flushRunning || !_initOk || isBlockedProductionProject || !isExpectedProject) return;
  const q = queueLoad();
  if (!q.length) return;
  _flushRunning = true;
  const remaining = [...q];
  for (const op of q) {
    try {
      if (op.type === 'upsert') {
        const s = sanitize(op.row);
        await withRetry(() => setDoc(doc(cirugiasRef, s.id), { ...s, _srv: serverTimestamp() }, { merge: true }));
      } else if (op.type === 'delete') {
        await withRetry(() => deleteDoc(doc(cirugiasRef, String(op.id))));
      }
      const idx = remaining.findIndex(x => x._qid === op._qid);
      if (idx !== -1) remaining.splice(idx, 1);
      queueSave(remaining);
    } catch (e) {
      console.error('[PFC Queue] op falló:', e.message);
    }
  }
  _flushRunning = false;
  if (queueLoad().length === 0) window.dispatchEvent(new CustomEvent('firestoreQueueFlushed'));
}

window.addEventListener('online', () => setTimeout(flushQueue, 1500));

async function upsertRow(row) {
  const s = sanitize(row);
  const id = String(s.id || Date.now());
  s.id = id;
  const qid = `upsert_${id}_${Date.now()}`;
  queueAdd({ _qid: qid, type: 'upsert', row: s, ts: new Date().toISOString() });
  if (!_initOk || isBlockedProductionProject || !isExpectedProject) return id;
  await withRetry(() => setDoc(doc(cirugiasRef, id), { ...s, _srv: serverTimestamp() }, { merge: true }));
  queueSave(queueLoad().filter(x => x._qid !== qid));
  return id;
}

async function deleteRow(id) {
  const sid = String(id);
  const qid = `del_${sid}_${Date.now()}`;
  queueAdd({ _qid: qid, type: 'delete', id: sid, ts: new Date().toISOString() });
  if (!_initOk || isBlockedProductionProject || !isExpectedProject) return;
  await withRetry(() => deleteDoc(doc(cirugiasRef, sid)));
  queueSave(queueLoad().filter(x => x._qid !== qid));
}

async function replaceAllRows(rows = []) {
  const CHUNK = 20;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await Promise.all(rows.slice(i, i + CHUNK).map(r => upsertRow(r)));
  }
}

function listenRows(onRows, onErr) {
  if (!_initOk || isBlockedProductionProject || !isExpectedProject) return () => {};
  if (role() === 'administrativo' && clinicId(profile().clinica)) {
    let ownRows = [];
    let programmedRows = [];
    const emit = () => {
      const unique = new Map();
      [...ownRows, ...programmedRows].forEach(row => unique.set(String(row.id), row));
      onRows([...unique.values()]);
    };
    const handleError = onErr || (e => console.error('[Firestore PFC] listener:', e));
    const unsubOwn = onSnapshot(
      ownClinicCirugiasRef(),
      { includeMetadataChanges: false },
      snap => { ownRows = snap.docs.map(d => normRow(d.data(), d.id)); emit(); },
      handleError
    );
    let unsubProgrammed = () => {};
    let refreshTimer = null;
    const subscribeProgrammed = () => {
      unsubProgrammed();
      unsubProgrammed = onSnapshot(
        programmedCirugiasRef(),
        { includeMetadataChanges: false },
        snap => { programmedRows = snap.docs.map(d => normRow(d.data(), d.id)); emit(); },
        handleError
      );
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(subscribeProgrammed, millisecondsUntilNextArgentinaDay());
    };
    subscribeProgrammed();
    return () => { unsubOwn(); unsubProgrammed(); clearTimeout(refreshTimer); };
  }
  return onSnapshot(
    ownClinicCirugiasRef(),
    { includeMetadataChanges: false },
    snap => onRows(snap.docs.map(d => normRow(d.data(), d.id))),
    onErr || (e => console.error('[Firestore PFC] listener:', e))
  );
}

async function exportAllRows() {
  if (!_initOk || isBlockedProductionProject || !isExpectedProject) throw new Error('Firestore DEMO no inicializado');
  if (role() === 'administrativo' && clinicId(profile().clinica)) {
    const [ownSnap, programmedSnap] = await Promise.all([
      getDocs(ownClinicCirugiasRef()),
      getDocs(programmedCirugiasRef())
    ]);
    const unique = new Map();
    [...ownSnap.docs, ...programmedSnap.docs].forEach(d => unique.set(d.id, normRow(d.data(), d.id)));
    return [...unique.values()];
  }
  const snap = await getDocs(ownClinicCirugiasRef());
  return snap.docs.map(d => normRow(d.data(), d.id));
}

function pendingCount() { return queueLoad().length; }
async function forcSync() { await flushQueue(); }

window.firestoreConnector = {
  ready: readyPromise,
  upsertRow, replaceAllRows, deleteRow, listenRows, exportAllRows,
  pendingCount, forcSync, flushQueue,
  getAuth: () => auth,
  getDb: () => db
};

readyPromise.then(ok => {
  window.dispatchEvent(new CustomEvent('firestoreReady', { detail: { ok } }));
  if (ok) setTimeout(flushQueue, 2000);
});
