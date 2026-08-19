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

function toFirestoreValue(value, key = '') {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (typeof value === 'object') {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toFirestoreValue(v, k)])) } };
  }
  return { stringValue: String(value) };
}

function fromFirestoreValue(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return new Date(value.timestampValue).toISOString();
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k, v]) => [k, fromFirestoreValue(v)]));
  return undefined;
}

function fieldsFor(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, toFirestoreValue(value, key)]));
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

async function deleteChunk(projectId, token, docs) {
  return Promise.all(docs.map(document => {
    const id = decodeURIComponent(document.name.split('/').pop());
    return jsonFetch(`${baseUrl(projectId)}/cirugias/${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: headers(token)
    });
  }));
}

async function main() {
  const verifyOnly = process.env.DEMO_VERIFY_ONLY === '1';
  const { projectId, apiKey } = parseConfig();
  const payload = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const rows = payload.episodes || [];
  if (payload.metadata?.projectId !== EXPECTED_PROJECT_ID) fail('el archivo generado no pertenece a proyecto-final-tig');
  if (payload.metadata?.episodios !== rows.length || rows.length < 500) fail('volumen generado inválido');
  if (new Set(rows.map(row => row.id)).size !== rows.length) fail('el archivo generado contiene IDs duplicados');
  if (new Set(rows.map(row => row.personaId)).size !== payload.metadata?.personas) fail('cantidad de personas inconsistente');
  if (rows.some(row => row.demoSynthetic !== true || row.extraVitrectomia || row.vitrectomia)) fail('dataset no sintético o con vitrectomía');
  if (JSON.stringify(payload).includes(BLOCKED_PROJECT_IDS.values().next().value)) fail('el dataset contiene una referencia al Firebase real');

  const auth = await signIn(apiKey);
  await verifySuperadmin(projectId, auth);
  const existing = await listCollection(projectId, auth.token);
  const generatedIds = new Set(rows.map(row => row.id));
  const existingDecoded = existing.map(doc => ({
    id: decodeURIComponent(doc.name.split('/').pop()),
    data: Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, fromFirestoreValue(v)]))
  }));
  if (existing.length) {
    if (existingDecoded.some(row => row.data.demoSynthetic !== true)) {
      fail(`/cirugias contiene documentos que no están marcados como sintéticos; no se reemplazará nada`);
    }
    console.log(`Se verificaron ${existing.length} documentos existentes, todos sintéticos.`);
  }

  if (!verifyOnly) {
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      await writeChunk(projectId, auth.token, rows.slice(i, i + CHUNK_SIZE));
      console.log(`Cargados ${Math.min(i + CHUNK_SIZE, rows.length)}/${rows.length}`);
    }

    const obsolete = existing.filter(doc => !generatedIds.has(decodeURIComponent(doc.name.split('/').pop())));
    for (let i = 0; i < obsolete.length; i += CHUNK_SIZE) {
      await deleteChunk(projectId, auth.token, obsolete.slice(i, i + CHUNK_SIZE));
      console.log(`Retirados ${Math.min(i + CHUNK_SIZE, obsolete.length)}/${obsolete.length} documentos sintéticos obsoletos`);
    }
  }

  const loaded = verifyOnly ? existing : await listCollection(projectId, auth.token);
  const decoded = loaded.map(doc => Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, fromFirestoreValue(v)])));
  const loadedIds = new Set(loaded.map(doc => decodeURIComponent(doc.name.split('/').pop())));
  if (loaded.length !== rows.length || [...generatedIds].some(id => !loadedIds.has(id))) {
    fail(`verificación posterior: se esperaban exactamente ${rows.length} documentos y hay ${loaded.length}`);
  }
  if (decoded.some(row => row.demoSynthetic !== true)) fail('verificación posterior: existe un documento sin marca sintética');
  const decodedById = new Map(decoded.map(row => [row.id, row]));
  for (const expected of rows) {
    const actual = decodedById.get(expected.id);
    if (!actual || Object.entries(expected).some(([key, value]) => JSON.stringify(actual[key]) !== JSON.stringify(value))) {
      fail(`verificación posterior: ${expected.id} no coincide con el dataset validado`);
    }
  }
  const clinics = decoded.reduce((acc, row) => (acc[row.clinica] = (acc[row.clinica] || 0) + 1, acc), {});
  if (clinics.clinica_a !== payload.metadata?.clinicas?.clinica_a || clinics.clinica_b !== payload.metadata?.clinicas?.clinica_b) {
    fail(`distribución posterior inválida: ${JSON.stringify(clinics)}`);
  }
  console.log(JSON.stringify({
    ok: true, modo: verifyOnly ? 'solo_verificacion' : 'carga_y_verificacion',
    projectId, documentos: loaded.length, personas: payload.metadata.personas,
    facturadas: payload.metadata.finalizadosFacturados, activos: payload.metadata.activos,
    facturadasPorMes: payload.metadata.facturadasPorMes,
    alertas: payload.metadata.alertas, clinicas: clinics, uid: auth.uid
  }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
