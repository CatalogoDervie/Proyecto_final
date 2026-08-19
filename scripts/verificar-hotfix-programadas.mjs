#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFechaProgramadaWorkflow, programadaHastaDia } from '../js/workflow-programada.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const payload = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'demo-cirugias.json'), 'utf8'));
const rulesSource = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
const firebaseSource = fs.readFileSync(path.join(ROOT, 'js', 'firebase.js'), 'utf8');
const rows = payload.episodes || [];
const referenceDate = payload.metadata?.fecha_demo;
const referenceNow = new Date(`${referenceDate}T15:00:00.000Z`);
const memoryStorage = new Map();
globalThis.localStorage = {
  getItem: key => memoryStorage.has(key) ? memoryStorage.get(key) : null,
  setItem: (key, value) => memoryStorage.set(key, String(value)),
  removeItem: key => memoryStorage.delete(key)
};
globalThis.window = { CURRENT_USER: null };
const { stateKey, WORKFLOW_KEYS } = await import('../js/state.js');
const { canViewRow, canEditClinic, canFacturar } = await import('../js/authz.js');

function assert(condition, message) {
  if (!condition) throw new Error(`HOTFIX_PROGRAMADAS_FALLIDO: ${message}`);
}
function byClinic(list, clinic) { return list.filter(row => row.clinica === clinic); }
function setAdmin(clinic) {
  window.CURRENT_USER = { uid: `test-${clinic}`, profile: { role: 'administrativo', clinica: clinic, active: true } };
}

assert(rows.length === 591, `se esperaban 591 episodios y hay ${rows.length}`);
const programmed = rows.filter(row => stateKey(row, referenceDate) === WORKFLOW_KEYS.FECHA_PROGRAMADA);
assert(programmed.length === 17, `FECHA_PROGRAMADA=${programmed.length}, esperado 17`);
assert(byClinic(programmed, 'clinica_a').length === 9, 'Clínica A debe tener 9 programadas');
assert(byClinic(programmed, 'clinica_b').length === 8, 'Clínica B debe tener 8 programadas');
assert(programmed.every(row => row.programadaHastaDia === programadaHastaDia(row, referenceDate)), 'programadaHastaDia no coincide con la definición funcional');
assert(rows.filter(row => row.estadoCir === 'Programada').length === 0, 'el diagnóstico esperaba cero estados textuales Programada');
assert(rulesSource.includes('resource.data.programadaHastaDia > argentinaTodayKey()'), 'Firestore Rules no usa la vigencia diaria canónica');
assert(!rulesSource.includes("resource.data.estadoCir == 'Programada'"), 'Firestore Rules conserva la condición textual defectuosa');
assert(!rulesSource.includes('allow read, write: if true'), 'Firestore Rules contiene acceso abierto');
assert(firebaseSource.includes("where(PROGRAMMED_UNTIL_FIELD, '>', argentinaDayKey())"), 'la consulta Firestore no usa la misma vigencia diaria');

const transitionSample = programmed[0];
const surgeryDayNoonUtc = new Date(`${transitionSample.fechaCir}T15:00:00.000Z`);
const dayAfter = new Date(`${String(programadaHastaDia(transitionSample, referenceDate)).slice(0, 4)}-${String(programadaHastaDia(transitionSample, referenceDate)).slice(4, 6)}-${String(programadaHastaDia(transitionSample, referenceDate)).slice(6, 8)}T03:00:01.000Z`);
setAdmin(transitionSample.clinica === 'clinica_a' ? 'clinica_b' : 'clinica_a');
assert(isFechaProgramadaWorkflow(transitionSample, transitionSample.fechaCir), 'la cirugía no permanece programada durante su fecha');
assert(transitionSample.programadaHastaDia > Number(transitionSample.fechaCir.replaceAll('-', '')), 'la vigencia no alcanza el final de la fecha quirúrgica');
assert(canViewRow(transitionSample, surgeryDayNoonUtc), 'la otra clínica no puede verla durante la fecha quirúrgica');
assert(!canViewRow(transitionSample, dayAfter), 'una programada vencida sigue visible para la otra clínica');
assert(programadaHastaDia({ ...transitionSample, estadoCir: 'Realizada' }, transitionSample.fechaCir) === null, 'marcar realizada no limpia la proyección');
assert(programadaHastaDia({ ...transitionSample, estadoFac: 'FACTURADA' }, transitionSample.fechaCir) === null, 'facturar no limpia la proyección');

const results = {};
for (const clinic of ['clinica_a', 'clinica_b']) {
  setAdmin(clinic);
  const other = clinic === 'clinica_a' ? 'clinica_b' : 'clinica_a';
  const visibleProgrammed = programmed.filter(row => canViewRow(row, referenceNow));
  const foreignNonProgrammed = rows.filter(row => row.clinica === other && !isFechaProgramadaWorkflow(row, referenceDate));
  assert(visibleProgrammed.length === 17, `${clinic} no puede leer las 17 programadas`);
  assert(byClinic(visibleProgrammed, 'clinica_a').length === 9, `${clinic} no ve las 9 de A`);
  assert(byClinic(visibleProgrammed, 'clinica_b').length === 8, `${clinic} no ve las 8 de B`);
  assert(foreignNonProgrammed.every(row => !canViewRow(row, referenceNow)), `${clinic} lee cartera no programada ajena`);
  assert(programmed.filter(row => row.clinica === other).every(row => !canEditClinic(row.clinica)), `${clinic} edita programadas ajenas`);
  const facturableOwn = rows.filter(row => row.clinica === clinic && row.estadoFac !== 'FACTURADA' && row.estadoCir === 'Realizada');
  const facturableOther = rows.filter(row => row.clinica === other && row.estadoFac !== 'FACTURADA' && row.estadoCir === 'Realizada');
  assert(canFacturar(), `${clinic} perdió acceso al módulo Facturar`);
  assert(facturableOwn.every(row => canEditClinic(row.clinica)), `${clinic} no puede operar su propia facturación`);
  assert(facturableOther.every(row => !canEditClinic(row.clinica)), `${clinic} podría facturar la otra clínica`);
  results[clinic] = {
    programadasVisibles: visibleProgrammed.length,
    clinicaA: byClinic(visibleProgrammed, 'clinica_a').length,
    clinicaB: byClinic(visibleProgrammed, 'clinica_b').length,
    noProgramadasAjenasBloqueadas: foreignNonProgrammed.length,
    programadasAjenasSoloLectura: programmed.filter(row => row.clinica === other).length,
    facturablesAjenasBloqueadas: facturableOther.length
  };
}

console.log(JSON.stringify({
  ok: true,
  fechaReferencia: referenceDate,
  episodios: rows.length,
  fechaProgramada: programmed.length,
  clinicaA: byClinic(programmed, 'clinica_a').length,
  clinicaB: byClinic(programmed, 'clinica_b').length,
  estadoCirProgramadaPersistido: rows.filter(row => row.estadoCir === 'Programada').length,
  soloPorFechaCir: programmed.filter(row => row.estadoCir !== 'Programada').length,
  politicaAdministrativos: results
}, null, 2));
