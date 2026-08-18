#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_PROJECT_ID = 'proyecto-final-tig';
const BLOCKED_PROJECT_IDS = new Set(['cirugias-we']);
const EXPECTED_SUPERADMIN_UID = 'oyVbmO40aqSIK9pCXihU4cOL2bS2';
const DATA_FILE = path.join(ROOT, 'data', 'demo-cirugias.json');
const CONFIG_FILE = path.join(ROOT, 'js', 'cliente-config.js');
const CHUNK_SIZE = 20;

function fail(message) { throw new Error(`CARGA_DEMO_BLOQUEADA: ${message}`); }
function parseConfig() {
  const source = fs.readFileSync(CONFIG_FILE, 'utf8');
  const projectId = source.match(/projectId:\s*['"]([^'"]+)['"]/)?.[1] || '';
  const apiKey = source.match(/apiKey:\s*['"]([^'"]+)['"]/)?.[1] || '';
  if (BLOCKED_PROJECT_IDS.has(projectId)) fail('se detectó el Firebase real cirugias-we');
  if (projectId !== EXPECTED_PROJECT_ID) fail(`projectId debe ser ${EXPECTED_PROJECT_ID}, recibido ${projectId || '(vacío)'}`);
  if (!apiKey) fail('apiKey ausente');
  return { projectId, apiKey };
}

function toFirestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (typeof value === 'object') {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toFirestoreValue(v)])) } };
  }
  return { stringValue: String(value) };
}

function fromFirestoreValue(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k, v]) => [k, fromFirestoreValue(v)]));
  return undefined;
}

function fieldsFor(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, toFirestoreValue(value)]));
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) {
    const detail = body?.error?.message || body?.error?.status || response.statusText;
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }
  return body;
}

async function signIn(apiKey) {
  const email = String(process.env.DEMO_EMAIL || '').trim();
  const password = String(process.env.DEMO_PASSWORD || '');
  if (!email || !password) fail('definir DEMO_EMAIL y DEMO_PASSWORD sin guardarlos en archivos');
  const auth = await jsonFetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  if (auth.localId !== EXPECTED_SUPERADMIN_UID) fail(`UID autenticado inesperado: ${auth.localId || '(vacío)'}`);
  return { token: auth.idToken, uid: auth.localId, email: auth.email };
}

function headers(token) { return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }; }
function baseUrl(projectId) { return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`; }

async function verifySuperadmin(projectId, auth) {
  const profile = await jsonFetch(`${baseUrl(projectId)}/usuarios/${auth.uid}`, { headers: headers(auth.token) });
  const data = Object.fromEntries(Object.entries(profile.fields || {}).map(([k, v]) => [k, fromFirestoreValue(v)]));
  if (data.email !== auth.email || data.role !== 'superadmin' || data.active !== true || data.clinica !== 'ambas') {
    fail('el perfil autenticado no es el superadmin activo esperado');
  }
}

async function listCollection(projectId, token) {
  const docs = [];
  let pageToken = '';
  do {
    const url = new URL(`${baseUrl(projectId)}/cirugias`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const page = await jsonFetch(url, { headers: headers(token) });
    docs.push(...(page.documents || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return docs;
}

async function writeChunk(projectId, token, rows) {
  return Promise.all(rows.map(row => jsonFetch(`${baseUrl(projectId)}/cirugias/${encodeURIComponent(row.id)}`, {
    method: 'PATCH', headers: headers(token), body: JSON.stringify({ fields: fieldsFor(row) })
  })));
}

async function main() {
  const { projectId, apiKey } = parseConfig();
  const payload = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const rows = payload.episodes || [];
  if (payload.metadata?.projectId !== EXPECTED_PROJECT_ID) fail('el archivo generado no pertenece a proyecto-final-tig');
  if (rows.length !== 350 || payload.metadata?.personas !== 200) fail('el archivo debe contener 200 personas y 350 episodios');
  if (rows.some(row => row.demoSynthetic !== true || row.extraVitrectomia || row.vitrectomia)) fail('dataset no sintético o con vitrectomía');

  const auth = await signIn(apiKey);
  await verifySuperadmin(projectId, auth);
  const existing = await listCollection(projectId, auth.token);
  if (existing.length) {
    const existingIds = new Set(existing.map(doc => decodeURIComponent(doc.name.split('/').pop())));
    const generatedIds = new Set(rows.map(row => row.id));
    const exactSameSet = existingIds.size === generatedIds.size && [...existingIds].every(id => generatedIds.has(id));
    if (!exactSameSet) fail(`/cirugias no está vacía (${existing.length} documentos) y contiene IDs ajenos a esta base demo`);
    console.log('La base demo ya tiene exactamente los 350 IDs esperados; se actualizará de forma idempotente.');
  }

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    await writeChunk(projectId, auth.token, rows.slice(i, i + CHUNK_SIZE));
    console.log(`Cargados ${Math.min(i + CHUNK_SIZE, rows.length)}/${rows.length}`);
  }

  const loaded = await listCollection(projectId, auth.token);
  const decoded = loaded.map(doc => Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, fromFirestoreValue(v)])));
  if (loaded.length !== 350) fail(`verificación posterior: se esperaban 350 documentos y hay ${loaded.length}`);
  if (decoded.some(row => row.demoSynthetic !== true)) fail('verificación posterior: existe un documento sin marca sintética');
  const clinics = decoded.reduce((acc, row) => (acc[row.clinica] = (acc[row.clinica] || 0) + 1, acc), {});
  if (clinics.clinica_a !== 175 || clinics.clinica_b !== 175) fail(`distribución posterior inválida: ${JSON.stringify(clinics)}`);
  console.log(JSON.stringify({ ok: true, projectId, documentos: loaded.length, clinicas: clinics, uid: auth.uid }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
