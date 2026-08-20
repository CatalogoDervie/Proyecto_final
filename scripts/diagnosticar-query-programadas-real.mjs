#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  argentinaDateISO,
  argentinaDayKey,
  isFechaProgramadaWorkflow,
  programadaHastaDia,
  programmedQueryDayBatches
} from '../js/workflow-programada.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_FILE = path.join(ROOT, 'js', 'cliente-config.js');
const EXPECTED_PROJECT_ID = 'proyecto-final-tig';
const BLOCKED_PROJECT_ID = 'cirugias-we';
const USERS = [
  {
    key: 'admin_a',
    email: 'clinicaa@clinicaoftalmologica.test',
    uid: 'bLEnN56iRxg2CmmCAXbcyx0suew1',
    clinic: 'clinica_a'
  },
  {
    key: 'admin_b',
    email: 'clinicab@clinicaoftalmologica.test',
    uid: '8rmnsYQkvYQCFEaxcCiVBRFpZMA2',
    clinic: 'clinica_b'
  }
];
const SUPERADMIN = {
  key: 'superadmin',
  email: 'superadmin@clinicaoftalmologica.test',
  uid: 'oyVbmO40aqSIK9pCXihU4cOL2bS2'
};

function fail(message) {
  throw new Error(`DIAGNOSTICO_QUERY_PROGRAMADAS_FALLIDO: ${message}`);
}

function parseConfig() {
  const source = fs.readFileSync(CONFIG_FILE, 'utf8');
  const projectId = source.match(/projectId:\s*['"]([^'"]+)['"]/)?.[1] || '';
  const apiKey = source.match(/apiKey:\s*['"]([^'"]+)['"]/)?.[1] || '';
  if (projectId === BLOCKED_PROJECT_ID) fail(`proyecto prohibido ${BLOCKED_PROJECT_ID}`);
  if (projectId !== EXPECTED_PROJECT_ID || !apiKey) fail('configuración Firebase no autorizada');
  return { projectId, apiKey };
}

function decode(value = {}) {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  return undefined;
}

function decodeDocument(document) {
  return {
    id: decodeURIComponent(document.name.split('/').pop()),
    ...Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, decode(value)]))
  };
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function documentsBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { ok: response.ok, status: response.status, body };
}

async function login(apiKey, user, password) {
  const result = await request(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password, returnSecureToken: true })
    }
  );
  if (!result.ok) fail(`Authentication ${user.key}: HTTP ${result.status}`);
  if (result.body.localId !== user.uid || result.body.email !== user.email) {
    fail(`${user.key}: UID o email no coincide`);
  }
  return { ...user, token: result.body.idToken };
}

async function runQuery(projectId, user, where = null) {
  const structuredQuery = { from: [{ collectionId: 'cirugias' }] };
  if (where) structuredQuery.where = { fieldFilter: where };
  return request(`${documentsBase(projectId)}:runQuery`, {
    method: 'POST',
    headers: authHeaders(user.token),
    body: JSON.stringify({ structuredQuery })
  });
}

async function getCirugia(projectId, user, id) {
  return request(`${documentsBase(projectId)}/cirugias/${encodeURIComponent(id)}`, {
    headers: authHeaders(user.token)
  });
}

function queryDocuments(result) {
  if (!result.ok || !Array.isArray(result.body)) return [];
  return result.body.filter(item => item.document).map(item => decodeDocument(item.document));
}

function errorSummary(result) {
  if (result.ok) return null;
  const nested = Array.isArray(result.body)
    ? result.body.find(item => item?.error)?.error
    : result.body?.error;
  return {
    http: result.status,
    code: nested?.status || '',
    message: nested?.message || ''
  };
}

function clinicFilter(clinic) {
  return {
    field: { fieldPath: 'clinica' },
    op: 'EQUAL',
    value: { stringValue: clinic }
  };
}

function programmedFilter(dayKey) {
  return {
    field: { fieldPath: 'programadaHastaDia' },
    op: 'GREATER_THAN',
    value: { integerValue: String(dayKey) }
  };
}

function programmedAtOrAfterFilter(dayKey) {
  return {
    field: { fieldPath: 'programadaHastaDia' },
    op: 'GREATER_THAN_OR_EQUAL',
    value: { integerValue: String(dayKey) }
  };
}

function programmedEqualFilter(dayKey) {
  return {
    field: { fieldPath: 'programadaHastaDia' },
    op: 'EQUAL',
    value: { integerValue: String(dayKey) }
  };
}

function programmedInFilter(dayKeys) {
  return {
    field: { fieldPath: 'programadaHastaDia' },
    op: 'IN',
    value: {
      arrayValue: {
        values: dayKeys.map(dayKey => ({ integerValue: String(dayKey) }))
      }
    }
  };
}

function futureDayKeys(referenceDate, days) {
  const [year, month, day] = referenceDate.split('-').map(Number);
  return Array.from({ length: days }, (_, index) => Number(
    new Date(Date.UTC(year, month - 1, day + index + 1, 12))
      .toISOString()
      .slice(0, 10)
      .replaceAll('-', '')
  ));
}

async function main() {
  const password = String(process.env.DEMO_PASSWORD || '');
  if (!password) fail('definir DEMO_PASSWORD únicamente como variable de entorno');
  const { projectId, apiKey } = parseConfig();
  const today = argentinaDateISO();
  const dayKey = argentinaDayKey();
  const superadmin = await login(apiKey, SUPERADMIN, password);
  const admins = [];
  for (const user of USERS) admins.push(await login(apiKey, user, password));

  const allResult = await runQuery(projectId, superadmin);
  if (!allResult.ok) fail(`superadmin no pudo consultar cirugías: HTTP ${allResult.status}`);
  const allRows = queryDocuments(allResult);
  const programmed = allRows.filter(row => isFechaProgramadaWorkflow(row, today));
  const projected = programmed.filter(row => Number.isInteger(row.programadaHastaDia));
  const invalidProjection = programmed.filter(row => row.programadaHastaDia !== programadaHastaDia(row, today));
  const clinicA = programmed.filter(row => row.clinica === 'clinica_a').length;
  const clinicB = programmed.filter(row => row.clinica === 'clinica_b').length;
  const projectedDays = [...new Set(programmed.map(row => row.programadaHastaDia))].sort((a, b) => a - b);
  const firstProjectedDay = projectedDays[0];
  const nextThirtyDays = futureDayKeys(today, 30);
  const queryBatches = programmedQueryDayBatches();

  const examples = programmed.slice(0, 4).map(row => ({
    id: row.id,
    clinica: row.clinica,
    fechaCir: row.fechaCir,
    programadaHastaDia: row.programadaHastaDia,
    esperado: programadaHastaDia(row, today)
  }));

  const adminResults = [];
  for (const admin of admins) {
    const otherClinic = admin.clinic === 'clinica_a' ? 'clinica_b' : 'clinica_a';
    const foreignProgrammed = programmed.find(row => row.clinica === otherClinic);
    const foreignNonProgrammed = allRows.find(row => row.clinica === otherClinic && !isFechaProgramadaWorkflow(row, today));
    if (!foreignProgrammed || !foreignNonProgrammed) fail(`${admin.key}: faltan muestras sintéticas`);

    const ownResult = await runQuery(projectId, admin, clinicFilter(admin.clinic));
    const programmedResult = await runQuery(projectId, admin, programmedFilter(dayKey));
    const programmedAtOrAfterResult = await runQuery(projectId, admin, programmedAtOrAfterFilter(firstProjectedDay));
    const programmedInResult = await runQuery(projectId, admin, programmedInFilter(nextThirtyDays));
    const batchResults = [];
    const batchDocuments = [];
    for (const [batchIndex, dayKeys] of queryBatches.entries()) {
      const result = await runQuery(projectId, admin, programmedInFilter(dayKeys));
      const documents = queryDocuments(result);
      batchDocuments.push(...documents);
      batchResults.push({
        batch: batchIndex + 1,
        desde: dayKeys[0],
        hasta: dayKeys.at(-1),
        ok: result.ok,
        documentos: documents.length,
        error: errorSummary(result)
      });
    }
    const equalityResults = [];
    for (const projectedDay of projectedDays) {
      const result = await runQuery(projectId, admin, programmedEqualFilter(projectedDay));
      equalityResults.push({
        programadaHastaDia: projectedDay,
        ok: result.ok,
        documentos: queryDocuments(result).length,
        error: errorSummary(result)
      });
    }
    const directProgrammed = await getCirugia(projectId, admin, foreignProgrammed.id);
    const directNonProgrammed = await getCirugia(projectId, admin, foreignNonProgrammed.id);
    const uniqueProgrammed = [...new Map(batchDocuments.map(row => [row.id, row])).values()]
      .filter(row => isFechaProgramadaWorkflow(row, today));
    const mergedRows = [...new Map(
      [...queryDocuments(ownResult), ...uniqueProgrammed].map(row => [row.id, row])
    ).values()];

    adminResults.push({
      usuario: admin.key,
      uid: admin.uid,
      role: 'administrativo',
      clinica: admin.clinic,
      argentinaDayKey: dayKey,
      consultaPropia: {
        ok: ownResult.ok,
        documentos: queryDocuments(ownResult).length,
        error: errorSummary(ownResult)
      },
      consultaProgramadasCompartidas: {
        filtro: `programadaHastaDia > ${dayKey}`,
        ok: programmedResult.ok,
        documentos: queryDocuments(programmedResult).length,
        error: errorSummary(programmedResult)
      },
      consultaProgramadasDesdePrimerDiaProyectado: {
        filtro: `programadaHastaDia >= ${firstProjectedDay}`,
        ok: programmedAtOrAfterResult.ok,
        documentos: queryDocuments(programmedAtOrAfterResult).length,
        error: errorSummary(programmedAtOrAfterResult)
      },
      consultaProgramadasPorDiasFuturos: {
        filtro: `programadaHastaDia IN [${nextThirtyDays[0]}..${nextThirtyDays.at(-1)}]`,
        ok: programmedInResult.ok,
        documentos: queryDocuments(programmedInResult).length,
        error: errorSummary(programmedInResult)
      },
      listenersProgramadasCorregidos: {
        lotes: batchResults.length,
        lotesPermitidos: batchResults.filter(result => result.ok).length,
        documentos: uniqueProgrammed.length,
        clinicaA: uniqueProgrammed.filter(row => row.clinica === 'clinica_a').length,
        clinicaB: uniqueProgrammed.filter(row => row.clinica === 'clinica_b').length,
        dbRowsCombinadas: mergedRows.length,
        errores: batchResults.filter(result => !result.ok)
      },
      consultasPorIgualdad: equalityResults,
      getProgramadaAjena: {
        ok: directProgrammed.ok,
        id: foreignProgrammed.id,
        error: errorSummary(directProgrammed)
      },
      getNoProgramadaAjena: {
        ok: directNonProgrammed.ok,
        id: foreignNonProgrammed.id,
        error: errorSummary(directNonProgrammed)
      }
    });
  }

  console.log(JSON.stringify({
    ok: true,
    modo: 'solo_lectura',
    projectId,
    fecha: today,
    argentinaDayKey: dayKey,
    datos: {
      episodios: allRows.length,
      fechaProgramada: programmed.length,
      clinicaA: clinicA,
      clinicaB: clinicB,
      programadaHastaDiaInteger: projected.length,
      proyeccionesIncorrectas: invalidProjection.length,
      diasProyectados: projectedDays,
      ejemplos: examples
    },
    administradores: adminResults
  }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
