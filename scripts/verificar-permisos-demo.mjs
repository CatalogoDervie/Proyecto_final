#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_FILE = path.join(ROOT, 'js', 'cliente-config.js');
const DATA_FILE = path.join(ROOT, 'data', 'demo-cirugias.json');
const REPORT_FILE = path.join(ROOT, 'data', 'demo-permisos.json');
const EXPECTED_PROJECT_ID = 'proyecto-final-tig';
const USERS = [
  { key: 'superadmin', email: 'superadmin@clinicaoftalmologica.test', uid: 'oyVbmO40aqSIK9pCXihU4cOL2bS2' },
  { key: 'admin_a', email: 'clinicaa@clinicaoftalmologica.test', uid: 'bLEnN56iRxg2CmmCAXbcyx0suew1' },
  { key: 'admin_b', email: 'clinicab@clinicaoftalmologica.test', uid: '8rmnsYQkvYQCFEaxcCiVBRFpZMA2' },
  { key: 'medico', email: 'medico@clinicaoftalmologica.test', uid: 'hO8Uq3YIwlcy16EDV90TESGf9AI3' },
  { key: 'supervisor', email: 'supervisor@clinicaoftalmologica.test', uid: 'oNkykUEAZuciiqCh9Am1U40lmJg2' }
];

function fail(message) { throw new Error(`PRUEBA_PERMISOS_FALLIDA: ${message}`); }
function parseConfig() {
  const source = fs.readFileSync(CONFIG_FILE, 'utf8');
  const projectId = source.match(/projectId:\s*['"]([^'"]+)['"]/)?.[1] || '';
  const apiKey = source.match(/apiKey:\s*['"]([^'"]+)['"]/)?.[1] || '';
  if (projectId === 'cirugias-we') fail('bloqueo explícito: cirugias-we');
  if (projectId !== EXPECTED_PROJECT_ID || !apiKey) fail('configuración Firebase no autorizada');
  return { projectId, apiKey };
}
function toValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } };
  if (typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toValue(v)])) } };
  return { stringValue: String(value) };
}
function fields(row) { return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, toValue(v)])); }
function base(projectId) { return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`; }
function authHeaders(token) { return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }; }
async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { ok: response.ok, status: response.status, body };
}
function expect(result, ok, label) {
  if (result.ok !== ok) fail(`${label}: HTTP ${result.status}, esperado ${ok ? 'permitido' : 'bloqueado'}`);
  return { operacion: label, resultado: ok ? 'PERMITIDA' : 'BLOQUEADA', http: result.status };
}
async function login(apiKey, user, password) {
  const result = await request(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password, returnSecureToken: true })
  });
  expect(result, true, `Authentication ${user.key}`);
  if (result.body.localId !== user.uid || result.body.email !== user.email) fail(`${user.key}: UID o email no coincide`);
  return { ...user, token: result.body.idToken };
}
async function getDoc(projectId, user, id) {
  return request(`${base(projectId)}/cirugias/${encodeURIComponent(id)}`, { headers: authHeaders(user.token) });
}
async function query(projectId, user, clinic = '') {
  const structuredQuery = { from: [{ collectionId: 'cirugias' }] };
  if (clinic) structuredQuery.where = { fieldFilter: { field: { fieldPath: 'clinica' }, op: 'EQUAL', value: { stringValue: clinic } } };
  return request(`${base(projectId)}:runQuery`, {
    method: 'POST', headers: authHeaders(user.token), body: JSON.stringify({ structuredQuery })
  });
}
async function listUsers(projectId, user) {
  return request(`${base(projectId)}/usuarios?pageSize=10`, { headers: authHeaders(user.token) });
}
async function writeDoc(projectId, user, id, row) {
  return request(`${base(projectId)}/cirugias/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: authHeaders(user.token),
    body: JSON.stringify({ fields: fields({ ...row, id }) })
  });
}
function queryCount(result) { return (result.body || []).filter(item => item.document).length; }

async function main() {
  const password = String(process.env.DEMO_PASSWORD || '');
  if (!password) fail('definir DEMO_PASSWORD únicamente como variable de entorno');
  const { projectId, apiKey } = parseConfig();
  const dataset = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')).episodes || [];
  if (dataset.length < 500) fail('dataset local inválido');
  const expectedByClinic = dataset.reduce((acc, row) => (acc[row.clinica] = (acc[row.clinica] || 0) + 1, acc), {});
  const rowA = dataset.find(x => x.clinica === 'clinica_a');
  const rowB = dataset.find(x => x.clinica === 'clinica_b');
  if (!rowA || !rowB) fail('faltan episodios de alguna clínica');

  const sessions = {};
  for (const user of USERS) sessions[user.key] = await login(apiKey, user, password);
  const operations = [];

  for (const spec of [
    { key: 'admin_a', own: rowA, other: rowB, clinic: 'clinica_a', forbidden: 'clinica_b' },
    { key: 'admin_b', own: rowB, other: rowA, clinic: 'clinica_b', forbidden: 'clinica_a' }
  ]) {
    const user = sessions[spec.key];
    operations.push(expect(await getDoc(projectId, user, spec.own.id), true, `${spec.key} lee propia clínica`));
    operations.push(expect(await getDoc(projectId, user, spec.other.id), false, `${spec.key} no lee otra clínica`));
    const ownQuery = await query(projectId, user, spec.clinic);
    operations.push(expect(ownQuery, true, `${spec.key} consulta propia clínica`));
    if (queryCount(ownQuery) !== expectedByClinic[spec.clinic]) fail(`${spec.key}: cantidad visible de episodios incorrecta`);
    operations.push(expect(await query(projectId, user, spec.forbidden), false, `${spec.key} consulta otra clínica`));
    operations.push(expect(await writeDoc(projectId, user, spec.own.id, spec.own), true, `${spec.key} edita propia clínica`));
    operations.push(expect(await writeDoc(projectId, user, spec.other.id, spec.other), false, `${spec.key} no edita otra clínica`));
    operations.push(expect(await writeDoc(projectId, user, spec.own.id, { ...spec.own, clinica: spec.forbidden }), false, `${spec.key} no cambia clínica`));
    operations.push(expect(await writeDoc(projectId, user, `EPI-INTENTO-DENEGADO-${spec.key.toUpperCase()}`, { ...spec.other, id: `EPI-INTENTO-DENEGADO-${spec.key.toUpperCase()}` }), false, `${spec.key} no crea en otra clínica`));
    operations.push(expect(await listUsers(projectId, user), false, `${spec.key} no administra usuarios`));
  }

  const medico = sessions.medico;
  operations.push(expect(await getDoc(projectId, medico, rowA.id), true, 'medico lee Clínica A'));
  operations.push(expect(await getDoc(projectId, medico, rowB.id), true, 'medico lee Clínica B'));
  const medicoAll = await query(projectId, medico);
  operations.push(expect(medicoAll, true, 'medico consulta ambas clínicas'));
  if (queryCount(medicoAll) !== dataset.length) fail(`medico debía ver ${dataset.length} episodios`);
  operations.push(expect(await writeDoc(projectId, medico, rowA.id, rowA), false, 'medico no modifica operación'));
  operations.push(expect(await listUsers(projectId, medico), false, 'medico no administra usuarios'));

  const supervisor = sessions.supervisor;
  operations.push(expect(await getDoc(projectId, supervisor, rowA.id), true, 'supervisor lee Clínica A'));
  operations.push(expect(await getDoc(projectId, supervisor, rowB.id), true, 'supervisor lee Clínica B'));
  operations.push(expect(await writeDoc(projectId, supervisor, rowA.id, rowA), true, 'supervisor edita Clínica A'));
  operations.push(expect(await writeDoc(projectId, supervisor, rowB.id, rowB), true, 'supervisor edita Clínica B'));
  operations.push(expect(await listUsers(projectId, supervisor), false, 'supervisor no administra usuarios'));

  const superadmin = sessions.superadmin;
  const adminAll = await query(projectId, superadmin);
  operations.push(expect(adminAll, true, 'superadmin consulta ambas clínicas'));
  if (queryCount(adminAll) !== dataset.length) fail(`superadmin debía ver ${dataset.length} episodios`);
  operations.push(expect(await writeDoc(projectId, superadmin, rowA.id, rowA), true, 'superadmin edita Clínica A'));
  operations.push(expect(await writeDoc(projectId, superadmin, rowB.id, rowB), true, 'superadmin edita Clínica B'));
  operations.push(expect(await listUsers(projectId, superadmin), true, 'superadmin administra usuarios'));

  const deniedIds = ['EPI-INTENTO-DENEGADO-ADMIN_A', 'EPI-INTENTO-DENEGADO-ADMIN_B'];
  for (const id of deniedIds) operations.push(expect(await getDoc(projectId, superadmin, id), false, `${id} no fue creado`));

  const report = {
    projectId, fecha: new Date().toISOString(), authentication: USERS.map(({ key, email, uid }) => ({ usuario: key, email, uid, ok: true })),
    operaciones: operations,
    permitidas: operations.filter(x => x.resultado === 'PERMITIDA').length,
    bloqueadas: operations.filter(x => x.resultado === 'BLOQUEADA').length,
    resultado: 'OK'
  };
  fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
