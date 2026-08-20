#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { argentinaDateISO, isFechaProgramadaWorkflow, programadaHastaDia } from '../js/workflow-programada.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_FILE = path.join(ROOT, 'js', 'cliente-config.js');
const EXPECTED_PROJECT_ID = 'proyecto-final-tig';
const BLOCKED_PROJECT_ID = 'cirugias-we';
const EXPECTED_UID = 'oyVbmO40aqSIK9pCXihU4cOL2bS2';

function fail(message) { throw new Error(`MIGRACION_PROGRAMADAS_BLOQUEADA: ${message}`); }
function parseConfig() {
  const source = fs.readFileSync(CONFIG_FILE, 'utf8');
  const projectId = source.match(/projectId:\s*['"]([^'"]+)['"]/)?.[1] || '';
  const apiKey = source.match(/apiKey:\s*['"]([^'"]+)['"]/)?.[1] || '';
  if (projectId === BLOCKED_PROJECT_ID) fail(`proyecto prohibido ${BLOCKED_PROJECT_ID}`);
  if (projectId !== EXPECTED_PROJECT_ID || !apiKey) fail('configuración Firebase no autorizada');
  return { projectId, apiKey };
}
function decode(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  return undefined;
}
async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) fail(`HTTP ${response.status}: ${body?.error?.message || response.statusText}`);
  return body;
}
function headers(token) { return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }; }
function base(projectId) { return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`; }
async function login(apiKey) {
  const email = String(process.env.DEMO_EMAIL || '').trim();
  const password = String(process.env.DEMO_PASSWORD || '');
  if (!email || !password) fail('definir DEMO_EMAIL y DEMO_PASSWORD solo en la terminal');
  const auth = await request(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  if (auth.localId !== EXPECTED_UID) fail(`UID inesperado ${auth.localId || '(vacío)'}`);
  return auth.idToken;
}
async function listRows(projectId, token) {
  const documents = [];
  let pageToken = '';
  do {
    const url = new URL(`${base(projectId)}/cirugias`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const page = await request(url, { headers: headers(token) });
    documents.push(...(page.documents || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return documents.map(document => ({
    id: decodeURIComponent(document.name.split('/').pop()),
    ...Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, decode(value)]))
  }));
}
async function patchProgrammedUntil(projectId, token, row, dayKey) {
  const url = new URL(`${base(projectId)}/cirugias/${encodeURIComponent(row.id)}`);
  url.searchParams.append('updateMask.fieldPaths', 'programadaHasta');
  url.searchParams.append('updateMask.fieldPaths', 'programadaHastaDia');
  await request(url, {
    method: 'PATCH', headers: headers(token),
    // programadaHasta queda omitido dentro de la máscara y por eso se elimina.
    body: JSON.stringify({ fields: { programadaHastaDia: { integerValue: String(dayKey) } } })
  });
}

async function main() {
  const apply = process.env.APPLY_PROGRAMMED_MIGRATION === '1';
  const { projectId, apiKey } = parseConfig();
  const token = await login(apiKey);
  const rows = await listRows(projectId, token);
  if (rows.length !== 591 || rows.some(row => row.demoSynthetic !== true)) fail('la colección no es la base sintética esperada de 591 episodios');
  const today = argentinaDateISO();
  const programmed = rows.filter(row => isFechaProgramadaWorkflow(row, today));
  const clinicaA = programmed.filter(row => row.clinica === 'clinica_a').length;
  const clinicaB = programmed.filter(row => row.clinica === 'clinica_b').length;
  if (programmed.length !== 17 || clinicaA !== 9 || clinicaB !== 8) {
    fail(`universo actual inesperado: total=${programmed.length}, A=${clinicaA}, B=${clinicaB}`);
  }
  const pending = programmed.filter(row => row.programadaHastaDia !== programadaHastaDia(row, today) || row.programadaHasta !== undefined);
  if (apply) {
    for (const row of pending) await patchProgrammedUntil(projectId, token, row, programadaHastaDia(row, today));
    const verified = await listRows(projectId, token);
    for (const row of programmed) {
      const current = verified.find(item => item.id === row.id);
      if (current?.programadaHastaDia !== programadaHastaDia(row, today) || current?.programadaHasta !== undefined) fail(`verificación falló para ${row.id}`);
    }
  }
  console.log(JSON.stringify({
    ok: true, modo: apply ? 'aplicada' : 'solo_diagnostico', projectId, fecha: today,
    documentos: rows.length, programadas: programmed.length, clinicaA, clinicaB,
    campoTecnico: 'programadaHastaDia', documentosAActualizar: pending.length,
    otrosCamposModificados: 0
  }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
