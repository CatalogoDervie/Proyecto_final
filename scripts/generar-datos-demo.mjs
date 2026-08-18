#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT = path.join(ROOT, 'data', 'demo-cirugias.json');
const DEFAULT_REPORT = path.join(ROOT, 'data', 'demo-resumen.json');
const EXPECTED_PROJECT_ID = 'proyecto-final-tig';
const BLOCKED_PROJECT_ID = 'cirugias-we';
const CLINICS = new Set(['clinica_a', 'clinica_b']);
const EYES = new Set(['OD', 'OI']);
const FULL_MONTH_TARGETS = [64, 69, 73, 62, 76, 68, 74, 67, 72, 65, 79, 70];
const ACTIVE_TARGETS = Object.freeze({ pedir: 12, esperando: 17, llego: 12, programada: 17, realizada: 10 });
const ALERT_SETTINGS = Object.freeze({
  secondEyeWarn: 30, secondEyeCrit: 45,
  lensDelayWarn: 10, lensDelayCrit: 20,
  arrivedWarn: 15, arrivedCrit: 30,
  billingWarn: 15, billingCrit: 30
});
const REQUIRED_FIELDS = [
  'id', 'personaId', 'clinica', 'nombre', 'dni', 'fnac', 'tel', 'dir',
  'obraSocial', 'afiliado', 'ojos', 'ojo', 'dioptria', 'model',
  'precioEspecial', 'fechaSolLente', 'fechaLlegaLente', 'recepLente',
  'fechaCir', 'hora', 'estadoCir', 'estadoFac', 'fechaFacturada',
  'fechaCarga', 'notas', 'extraSutura', 'extraInyeccion',
  'extraVitrectomia', 'vitrectomia', 'demoSynthetic', 'demoSeed'
];

function parseArgs(argv) {
  const args = { fechaDemo: '2026-08-17', seed: 20260817, output: DEFAULT_OUTPUT, report: DEFAULT_REPORT };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === '--fecha-demo') args.fechaDemo = val, i += 1;
    else if (key === '--seed') args.seed = Number(val), i += 1;
    else if (key === '--output') args.output = path.resolve(val), i += 1;
    else if (key === '--report') args.report = path.resolve(val), i += 1;
  }
  return args;
}
function assert(condition, message) { if (!condition) throw new Error(`VALIDACION_DEMO: ${message}`); }
function parseISO(value) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')), `fecha inválida: ${value}`);
  const date = new Date(`${value}T12:00:00Z`);
  assert(!Number.isNaN(date.getTime()), `fecha inválida: ${value}`);
  return date;
}
function iso(date) { return date.toISOString().slice(0, 10); }
function addDays(value, days) {
  const date = typeof value === 'string' ? parseISO(value) : new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return iso(date);
}
function diffDays(a, b) { return Math.round((parseISO(a) - parseISO(b)) / 86400000); }
function pad(value, size = 2) { return String(value).padStart(size, '0'); }
function clampDate(value, min, max) { return value < min ? min : value > max ? max : value; }
function monthKey(value) { return String(value || '').slice(0, 7); }
function daysInMonth(year, monthOneBased) { return new Date(Date.UTC(year, monthOneBased, 0)).getUTCDate(); }
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(list, rnd) { return list[Math.floor(rnd() * list.length)]; }

const FIRST_NAMES = [
  'Adriana', 'Alberto', 'Alicia', 'Amalia', 'Antonio', 'Beatriz', 'Carlos',
  'Celia', 'Claudio', 'Diana', 'Eduardo', 'Elena', 'Esteban', 'Eva',
  'Federico', 'Graciela', 'Héctor', 'Inés', 'Jorge', 'Laura', 'Leonardo',
  'Lucía', 'Marcela', 'Marta', 'Miguel', 'Mónica', 'Néstor', 'Norma',
  'Oscar', 'Patricia', 'Raúl', 'Rosa', 'Silvia', 'Teresa', 'Víctor'
];
const LAST_NAMES = [
  'Abedul', 'Alameda', 'Amapola', 'Arrayán', 'Azucena', 'Ceibo', 'Ciprés',
  'Fresno', 'Jacarandá', 'Laurel', 'Magnolia', 'Nogal', 'Olivo', 'Ombú',
  'Paraíso', 'Pino', 'Roble', 'Sauce', 'Tilo', 'Trébol'
];

function personData(index, rnd) {
  const year = 1936 + (index * 17 % 31);
  const month = 1 + (index * 7 % 12);
  const day = 1 + (index * 11 % 27);
  return {
    personaId: `PAC-${pad(index, 4)}`,
    nombre: `${pick(FIRST_NAMES, rnd)} ${pick(LAST_NAMES, rnd)} Demo ${pad(index, 4)}`,
    dni: String(99000000 + index),
    fnac: `${year}-${pad(month)}-${pad(day)}`,
    tel: `+54 9 000 000 ${pad(index, 4)}`,
    dir: `Calle Demo ${1000 + index}, Ciudad Académica`,
    obraSocial: 'PAMI', afiliado: String(990000000000 + index)
  };
}

function fullMonthTarget(year, monthOneBased, seed) {
  const base = FULL_MONTH_TARGETS[(monthOneBased - 1) % FULL_MONTH_TARGETS.length];
  if (year === 2026) return base;
  const drift = ((year * 17 + monthOneBased * 11 + seed) % 7) - 3;
  return Math.max(60, Math.min(80, base + drift));
}
function monthlyBillingPlan(fechaDemo, seed) {
  const demo = parseISO(fechaDemo);
  const plan = [];
  let year = 2026;
  let month = 1;
  while (year < demo.getUTCFullYear() || (year === demo.getUTCFullYear() && month <= demo.getUTCMonth() + 1)) {
    const full = fullMonthTarget(year, month, seed);
    const current = year === demo.getUTCFullYear() && month === demo.getUTCMonth() + 1;
    const target = current ? Math.max(1, Math.round(full * demo.getUTCDate() / daysInMonth(year, month))) : full;
    plan.push({ key: `${year}-${pad(month)}`, year, month, target, current, availableDays: current ? demo.getUTCDate() : daysInMonth(year, month) });
    month += 1;
    if (month === 13) year += 1, month = 1;
  }
  return plan;
}
function billedDescriptor(month, index, globalIndex) {
  const maxDay = Math.max(4, month.availableDays);
  const invoiceDay = 4 + ((index * 7 + month.month * 5 + globalIndex) % Math.max(1, maxDay - 3));
  const fechaFacturada = `${month.year}-${pad(month.month)}-${pad(Math.min(invoiceDay, month.availableDays))}`;
  const fechaCir = addDays(fechaFacturada, -(1 + globalIndex % 3));
  const fechaLlegaLente = addDays(fechaCir, -(6 + globalIndex % 6));
  const fechaSolLente = addDays(fechaLlegaLente, -(10 + globalIndex % 11));
  return {
    kind: 'facturada', billingMonth: month.key, fechaSolLente, fechaLlegaLente,
    recepLente: 'Correcta', fechaCir,
    hora: `${pad(8 + globalIndex % 7)}:${globalIndex % 3 === 0 ? '00' : globalIndex % 3 === 1 ? '20' : '40'}`,
    estadoCir: 'Realizada', estadoFac: 'FACTURADA', fechaFacturada, stageDemo: 'facturada'
  };
}

function activeTargetsForBilled(billedCount) {
  const scale = Math.max(0.75, billedCount / 523);
  return Object.fromEntries(Object.entries(ACTIVE_TARGETS).map(([key, count]) => [key, Math.max(1, Math.round(count * scale))]));
}
function bandForIndex(index, total, weights) {
  const weightTotal = weights.normal + weights.yellow + weights.red;
  const red = Math.max(1, Math.round(total * weights.red / weightTotal));
  const yellow = Math.max(1, Math.round(total * weights.yellow / weightTotal));
  const normal = Math.max(0, total - red - yellow);
  return index < normal ? 'normal' : index < normal + yellow ? 'yellow' : 'red';
}
function activeDescriptors(fechaDemo, targets) {
  const rows = [];
  for (let i = 0; i < targets.pedir; i += 1) rows.push({ kind: 'pedir', fechaSolLente: '', fechaLlegaLente: '', recepLente: '', fechaCir: '', hora: '', estadoCir: '', estadoFac: '', fechaFacturada: '', stageDemo: 'pendiente_pedir_lente' });
  for (let i = 0; i < targets.esperando; i += 1) {
    const band = bandForIndex(i, targets.esperando, { normal: 9, yellow: 6, red: 2 });
    const age = band === 'normal' ? 2 + i % 7 : band === 'yellow' ? 11 + i % 8 : 23 + i % 8;
    rows.push({ kind: 'esperando', fechaSolLente: addDays(fechaDemo, -age), fechaLlegaLente: '', recepLente: '', fechaCir: '', hora: '', estadoCir: '', estadoFac: '', fechaFacturada: '', stageDemo: `esperando_${band}` });
  }
  for (let i = 0; i < targets.llego; i += 1) {
    const band = bandForIndex(i, targets.llego, { normal: 6, yellow: 4, red: 2 });
    const age = band === 'normal' ? 3 + i % 9 : band === 'yellow' ? 17 + i % 10 : 33 + i % 8;
    const fechaLlegaLente = addDays(fechaDemo, -age);
    rows.push({ kind: 'llego', fechaSolLente: addDays(fechaLlegaLente, -(11 + i % 7)), fechaLlegaLente, recepLente: 'Correcta', fechaCir: '', hora: '', estadoCir: '', estadoFac: '', fechaFacturada: '', stageDemo: `lente_recibida_${band}` });
  }
  for (let i = 0; i < targets.programada; i += 1) {
    const fechaCir = addDays(fechaDemo, [3, 5, 7, 10, 12, 14, 18, 21][i % 8]);
    const fechaLlegaLente = addDays(fechaDemo, -(2 + i % 8));
    rows.push({ kind: 'programada', fechaSolLente: addDays(fechaLlegaLente, -(12 + i % 8)), fechaLlegaLente, recepLente: 'Correcta', fechaCir, hora: `${pad(8 + i % 7)}:${i % 2 ? '30' : '00'}`, estadoCir: '', estadoFac: '', fechaFacturada: '', stageDemo: 'cirugia_programada' });
  }
  for (let i = 0; i < targets.realizada; i += 1) {
    const band = bandForIndex(i, targets.realizada, { normal: 5, yellow: 3, red: 2 });
    const age = band === 'normal' ? 3 + i % 8 : band === 'yellow' ? 17 + i % 10 : 34 + i % 8;
    const fechaCir = addDays(fechaDemo, -age);
    const fechaLlegaLente = addDays(fechaCir, -(6 + i % 6));
    rows.push({ kind: 'realizada', fechaSolLente: addDays(fechaLlegaLente, -(11 + i % 8)), fechaLlegaLente, recepLente: 'Correcta', fechaCir, hora: `${pad(8 + i % 7)}:${i % 2 ? '30' : '00'}`, estadoCir: 'Realizada', estadoFac: '', fechaFacturada: '', stageDemo: `realizada_${band}_sin_facturar` });
  }
  return rows;
}
function personClinic(personIndex) { return ((personIndex * 7) % 20) < 11 ? 'clinica_a' : 'clinica_b'; }
function singleEye(personIndex) { return ((personIndex * 9) % 20) < 11 ? 'OD' : 'OI'; }
function setSecondEyeDates(descriptor, fechaDemo, severity) {
  const age = severity === 'yellow' ? 35 : severity === 'red' ? 55 : 10;
  descriptor.fechaFacturada = addDays(fechaDemo, -age);
  descriptor.fechaCir = addDays(descriptor.fechaFacturada, -2);
  descriptor.fechaLlegaLente = addDays(descriptor.fechaCir, -8);
  descriptor.fechaSolLente = addDays(descriptor.fechaLlegaLente, -15);
  descriptor.billingMonth = monthKey(descriptor.fechaFacturada);
  descriptor.stageDemo = severity === 'normal' ? 'facturada_falta_segundo_ojo_reciente' : `facturada_falta_segundo_ojo_${severity}`;
}
function descriptorPools(args) {
  const plan = monthlyBillingPlan(args.fechaDemo, args.seed);
  const billed = [];
  let globalIndex = 0;
  for (const month of plan) for (let i = 0; i < month.target; i += 1) billed.push(billedDescriptor(month, i, ++globalIndex));
  billed.sort((a, b) => a.fechaFacturada.localeCompare(b.fechaFacturada));
  const activeTargets = activeTargetsForBilled(billed.length);
  return { plan, billed, activeTargets, active: activeDescriptors(args.fechaDemo, activeTargets) };
}

function assignPeople(args, pools, rnd) {
  const totalEpisodes = pools.billed.length + pools.active.length;
  const dualPersons = Math.round(totalEpisodes * 0.34);
  const mixedPairs = Math.min(20, pools.active.length);
  const completedPairs = dualPersons - mixedPairs;
  assert(pools.billed.length >= completedPairs * 2 + mixedPairs, 'faltan facturadas para la estructura bilateral');
  const billed = [...pools.billed];
  const completed = [];
  for (let i = 0; i < completedPairs; i += 1) {
    const first = billed.shift();
    const targetInterval = 28 + i % 29;
    let secondIndex = billed.findIndex(candidate => diffDays(candidate.fechaCir, first.fechaCir) >= targetInterval);
    if (secondIndex < 0 || diffDays(billed[secondIndex].fechaCir, first.fechaCir) > 120) {
      secondIndex = billed.findIndex(candidate => {
        const interval = diffDays(candidate.fechaCir, first.fechaCir);
        return interval >= 14 && interval <= 120;
      });
    }
    assert(secondIndex >= 0, `no se pudo formar el par bilateral ${i + 1}`);
    completed.push([first, billed.splice(secondIndex, 1)[0]]);
  }
  const firstMixed = billed.splice(Math.max(0, billed.length - mixedPairs), mixedPairs);
  const secondMixed = pools.active.splice(0, mixedPairs);
  const groups = [];
  completed.forEach(pair => groups.push({ descriptors: pair, type: 'ambos_ojos_finalizados' }));
  firstMixed.forEach((first, index) => groups.push({ descriptors: [first, secondMixed[index]], type: 'primer_ojo_finalizado_segundo_en_proceso' }));
  billed.forEach(descriptor => groups.push({ descriptors: [descriptor], type: 'un_episodio_facturado' }));
  pools.active.forEach(descriptor => groups.push({ descriptors: [descriptor], type: 'un_episodio_activo' }));

  const singleFactured = groups.filter(group => group.type === 'un_episodio_facturado');
  const takeByMonth = (month, count, severity) => {
    const candidates = singleFactured.filter(group => !group.plannedSecondEye && group.descriptors[0].billingMonth === month);
    assert(candidates.length >= count, `faltan facturadas individuales en ${month} para alertas ${severity}`);
    candidates.slice(0, count).forEach(group => {
      group.plannedSecondEye = true;
      setSecondEyeDates(group.descriptors[0], args.fechaDemo, severity);
      group.type = `primer_ojo_facturado_falta_segundo_${severity}`;
    });
  };
  const activeYellow = pools.active.filter(descriptor => descriptor.stageDemo.includes('_yellow')).length
    + secondMixed.filter(descriptor => descriptor.stageDemo.includes('_yellow')).length;
  const activeRed = pools.active.filter(descriptor => descriptor.stageDemo.includes('_red')).length
    + secondMixed.filter(descriptor => descriptor.stageDemo.includes('_red')).length;
  const targetYellow = Math.round(totalEpisodes * 0.06);
  const targetRed = Math.round(totalEpisodes * 0.025);
  takeByMonth(monthKey(addDays(args.fechaDemo, -35)), Math.max(1, targetYellow - activeYellow), 'yellow');
  takeByMonth(monthKey(addDays(args.fechaDemo, -55)), Math.max(1, targetRed - activeRed), 'red');
  takeByMonth(monthKey(addDays(args.fechaDemo, -10)), 6, 'normal');

  const episodes = [];
  groups.forEach((group, groupIndex) => {
    const personIndex = groupIndex + 1;
    const person = personData(personIndex, rnd);
    const clinic = personClinic(personIndex);
    const firstEye = group.descriptors.length === 2 ? (personIndex % 2 ? 'OD' : 'OI') : singleEye(personIndex);
    group.descriptors.forEach((descriptor, eyeIndex) => {
      const { kind: _kind, billingMonth: _billingMonth, stageDemo: _stageDemo, ...timeline } = descriptor;
      const eye = eyeIndex === 0 ? firstEye : firstEye === 'OD' ? 'OI' : 'OD';
      const sequence = episodes.length + 1;
      const special = sequence % 12 === 0 || sequence % 29 === 0;
      const baseDate = descriptor.fechaSolLente || descriptor.fechaCir || addDays(args.fechaDemo, -(sequence % 45));
      const fechaCarga = clampDate(addDays(baseDate, -(2 + sequence % 5)), '2026-01-01', args.fechaDemo);
      episodes.push({
        id: `EPI-${person.personaId}-${eye}`, personaId: person.personaId, clinica: clinic,
        nombre: person.nombre, dni: person.dni, fnac: person.fnac, tel: person.tel, dir: person.dir,
        obraSocial: person.obraSocial, afiliado: person.afiliado,
        ojos: group.descriptors.length === 2 || group.plannedSecondEye ? '2 ojos' : '1 ojo', ojo: eye,
        dioptria: `${17 + (sequence % 19) * 0.5}`,
        model: special ? 'LIO monofocal especial demo' : 'LIO monofocal estándar demo',
        precioEspecial: special ? 180000 + (sequence % 5) * 25000 : '',
        ...timeline,
        fechaCarga,
        notas: `CASO SINTÉTICO DE DEMOSTRACIÓN — ${group.type.replaceAll('_', ' ')}${special ? ' — lente especial' : ''}.`,
        extraSutura: sequence % 19 === 0, extraInyeccion: sequence % 17 === 0,
        extraVitrectomia: false, vitrectomia: false, ecografiaImagen: '', ecografiaMes: '', facturarSeleccionado: false,
        demoSynthetic: true, demoSeed: args.seed, demoFecha: args.fechaDemo,
        createdAt: `${fechaCarga}T12:00:00.000Z`, updatedAt: `${args.fechaDemo}T12:00:00.000Z`
      });
    });
  });
  return { episodes, groups };
}

function getOtherEye(row, rows) { return rows.find(other => other.personaId === row.personaId && other.id !== row.id && other.ojo !== row.ojo) || null; }
function workflowState(row, rows) {
  if (!row.dioptria) return 'FALTA_DIOPTRIA';
  if (!row.fechaSolLente) return 'PEDIR_LENTE';
  if (!row.fechaLlegaLente) return 'ESPERANDO_LENTE';
  if (!row.fechaCir) return 'LLEGO_LENTE_PROGRAMAR';
  if (row.estadoFac === 'FACTURADA') {
    if (row.ojos === '2 ojos') return getOtherEye(row, rows) ? 'FINALIZADA' : 'FACTURADA_FALTA_OTRO_OJO';
    return 'FACTURADA';
  }
  return row.estadoCir === 'Realizada' || row.fechaCir < row.demoFecha ? 'REALIZADA_FALTA_FACTURAR' : 'FECHA_PROGRAMADA';
}
function alertSeverity(row, rows, fechaDemo) {
  const state = workflowState(row, rows);
  let age = 0, warn = 0, crit = 0;
  if (state === 'ESPERANDO_LENTE') age = diffDays(fechaDemo, row.fechaSolLente), warn = ALERT_SETTINGS.lensDelayWarn, crit = ALERT_SETTINGS.lensDelayCrit;
  else if (state === 'LLEGO_LENTE_PROGRAMAR') age = diffDays(fechaDemo, row.fechaLlegaLente), warn = ALERT_SETTINGS.arrivedWarn, crit = ALERT_SETTINGS.arrivedCrit;
  else if (state === 'REALIZADA_FALTA_FACTURAR') age = diffDays(fechaDemo, row.fechaCir), warn = ALERT_SETTINGS.billingWarn, crit = ALERT_SETTINGS.billingCrit;
  else if (state === 'FACTURADA_FALTA_OTRO_OJO') age = diffDays(fechaDemo, row.fechaFacturada), warn = ALERT_SETTINGS.secondEyeWarn, crit = ALERT_SETTINGS.secondEyeCrit;
  else return '';
  return age >= crit ? 'red' : age >= warn ? 'yellow' : '';
}
function countBy(rows, fn) { return rows.reduce((acc, row) => (acc[fn(row)] = (acc[fn(row)] || 0) + 1, acc), {}); }

function summarize(episodes, groups, plan, args, validation) {
  const states = countBy(episodes, row => workflowState(row, episodes));
  const alerts = countBy(episodes, row => alertSeverity(row, episodes, args.fechaDemo) || 'sin_alerta');
  const clinics = countBy(episodes, row => row.clinica);
  const eyes = countBy(episodes, row => row.ojo);
  const billed = episodes.filter(row => row.estadoFac === 'FACTURADA');
  const billedByMonth = countBy(billed, row => monthKey(row.fechaFacturada));
  const surgeryClinics = new Map();
  episodes.filter(row => row.fechaCir).forEach(row => {
    if (!surgeryClinics.has(row.fechaCir)) surgeryClinics.set(row.fechaCir, new Set());
    surgeryClinics.get(row.fechaCir).add(row.clinica);
  });
  const mixedDays = [...surgeryClinics.entries()].filter(([, set]) => set.size === 2).map(([date]) => date).sort();
  const totalAlerts = (alerts.yellow || 0) + (alerts.red || 0);
  return {
    projectId: EXPECTED_PROJECT_ID, fecha_demo: args.fechaDemo, seed: args.seed,
    personas: groups.length, episodios: episodes.length,
    personasDosEpisodios: groups.filter(group => group.descriptors.length === 2).length,
    personasUnEpisodio: groups.filter(group => group.descriptors.length === 1).length,
    finalizadosFacturados: billed.length, activos: episodes.length - billed.length,
    porcentajeFacturados: Number((billed.length * 100 / episodes.length).toFixed(2)),
    facturadasPorMes: Object.fromEntries(plan.map(month => [month.key, billedByMonth[month.key] || 0])),
    estados: states, clinicas: clinics,
    porcentajeClinicaA: Number(((clinics.clinica_a || 0) * 100 / episodes.length).toFixed(2)),
    ojos: eyes, alertas: alerts, totalAlertas: totalAlerts,
    porcentajeConAlerta: Number((totalAlerts * 100 / episodes.length).toFixed(2)),
    porcentajeSinAlerta: Number(((alerts.sin_alerta || 0) * 100 / episodes.length).toFixed(2)),
    lentesEspeciales: episodes.filter(row => Number(row.precioEspecial) > 0).length,
    totalDiasQuirurgicosMixtos: mixedDays.length, diasQuirurgicosMixtos: mixedDays,
    vitrectomias: episodes.filter(row => row.extraVitrectomia || row.vitrectomia).length,
    datosReales: 0, validation
  };
}

function validateDataset(episodes, groups, plan, args) {
  const errors = [];
  const check = (condition, message) => { if (!condition) errors.push(message); };
  const billedTotal = plan.reduce((sum, month) => sum + month.target, 0);
  const expectedTotal = billedTotal
    + Object.values(activeTargetsForBilled(billedTotal)).reduce((sum, count) => sum + count, 0);
  check(episodes.length === expectedTotal, `volumen ${episodes.length}; esperado ${expectedTotal} según facturación y cartera activa`);
  check(new Set(episodes.map(row => row.id)).size === episodes.length, 'IDs duplicados');
  const byPerson = new Map();
  episodes.forEach(row => {
    if (!byPerson.has(row.personaId)) byPerson.set(row.personaId, []);
    byPerson.get(row.personaId).push(row);
    REQUIRED_FIELDS.forEach(field => check(Object.hasOwn(row, field), `${row.id}: falta ${field}`));
    check(row.demoSynthetic === true, `${row.id}: no sintético`);
    check(/^99\d{6}$/.test(row.dni), `${row.id}: DNI no sintético`);
    check(row.dir.includes('Ciudad Académica'), `${row.id}: dirección no sintética`);
    check(CLINICS.has(row.clinica) && EYES.has(row.ojo), `${row.id}: clínica u ojo inválido`);
    check(!row.extraVitrectomia && !row.vitrectomia, `${row.id}: vitrectomía prohibida`);
    check(!JSON.stringify(row).includes(BLOCKED_PROJECT_ID), `${row.id}: referencia prohibida`);
    if (row.fechaLlegaLente) check(row.fechaSolLente <= row.fechaLlegaLente, `${row.id}: llegada anterior a solicitud`);
    if (row.fechaCir) check(row.fechaLlegaLente && row.fechaLlegaLente <= row.fechaCir, `${row.id}: cirugía anterior a llegada`);
    if (row.estadoCir === 'Realizada') check(row.fechaCir <= args.fechaDemo, `${row.id}: realizada futura`);
    if (row.estadoFac === 'FACTURADA') check(row.fechaFacturada >= row.fechaCir && row.fechaFacturada <= args.fechaDemo, `${row.id}: facturación incoherente`);
  });
  for (const [personId, rows] of byPerson) {
    check(rows.length <= 2, `${personId}: más de dos episodios`);
    check(new Set(rows.map(row => row.ojo)).size === rows.length, `${personId}: ojo repetido`);
    for (const key of ['nombre', 'dni', 'fnac', 'tel', 'dir', 'afiliado', 'clinica']) check(new Set(rows.map(row => row[key])).size === 1, `${personId}: ${key} difiere`);
    if (rows.length === 2 && rows.every(row => row.estadoFac === 'FACTURADA')) {
      const dates = rows.map(row => row.fechaCir).sort();
      const interval = diffDays(dates[1], dates[0]);
      check(interval >= 14 && interval <= 120, `${personId}: intervalo entre ojos ${interval} días`);
    }
  }
  const billedByMonth = countBy(episodes.filter(row => row.estadoFac === 'FACTURADA'), row => monthKey(row.fechaFacturada));
  plan.forEach(month => {
    check((billedByMonth[month.key] || 0) === month.target, `${month.key}: ${billedByMonth[month.key] || 0} en vez de ${month.target}`);
    if (!month.current) check(month.target >= 60 && month.target <= 80, `${month.key}: fuera de 60–80`);
  });
  if (errors.length) throw new Error(`VALIDACION_DEMO: ${errors.slice(0, 25).join(' | ')}${errors.length > 25 ? ` | +${errors.length - 25}` : ''}`);
  return { ok: true, checks: 29, errors: 0 };
}

function generate(args) {
  parseISO(args.fechaDemo);
  assert(args.fechaDemo >= '2026-03-01', 'fecha_demo demasiado temprana');
  const rnd = mulberry32(args.seed);
  const pools = descriptorPools(args);
  const { episodes, groups } = assignPeople(args, pools, rnd);
  const validation = validateDataset(episodes, groups, pools.plan, args);
  const summary = summarize(episodes, groups, pools.plan, args, validation);
  assert(summary.porcentajeFacturados >= 85 && summary.porcentajeFacturados <= 92, `facturados ${summary.porcentajeFacturados}%`);
  assert(summary.porcentajeConAlerta >= 8 && summary.porcentajeConAlerta <= 15, `alertas ${summary.porcentajeConAlerta}%`);
  assert((summary.alertas.yellow || 0) > (summary.alertas.red || 0), 'debe haber más amarillas que rojas');
  assert((summary.alertas.yellow || 0) / summary.episodios >= 0.05 && (summary.alertas.yellow || 0) / summary.episodios <= 0.09, 'amarillas fuera de 5–9%');
  assert((summary.alertas.red || 0) / summary.episodios >= 0.02 && (summary.alertas.red || 0) / summary.episodios <= 0.04, 'rojas fuera de 2–4%');
  assert(summary.porcentajeClinicaA >= 52 && summary.porcentajeClinicaA <= 58, `Clínica A ${summary.porcentajeClinicaA}%`);
  const odShare = (summary.ojos.OD || 0) / summary.episodios;
  assert(odShare >= 0.47 && odShare <= 0.53 && summary.ojos.OD !== summary.ojos.OI, 'OD/OI inválido');
  assert(summary.totalDiasQuirurgicosMixtos >= 8, 'faltan días quirúrgicos mixtos');
  return { episodes, summary };
}

const args = parseArgs(process.argv.slice(2));
const { episodes, summary } = generate(args);
fs.mkdirSync(path.dirname(args.output), { recursive: true });
fs.mkdirSync(path.dirname(args.report), { recursive: true });
fs.writeFileSync(args.output, `${JSON.stringify({ metadata: summary, episodes }, null, 2)}\n`, 'utf8');
fs.writeFileSync(args.report, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(summary, null, 2));
