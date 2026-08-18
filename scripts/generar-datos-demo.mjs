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
const REQUIRED_FIELDS = [
  'id', 'personaId', 'clinica', 'nombre', 'dni', 'fnac', 'tel', 'dir',
  'obraSocial', 'afiliado', 'ojos', 'ojo', 'dioptria', 'model',
  'precioEspecial', 'fechaSolLente', 'fechaLlegaLente', 'recepLente',
  'fechaCir', 'hora', 'estadoCir', 'estadoFac', 'fechaFacturada',
  'fechaCarga', 'notas', 'extraSutura', 'extraInyeccion',
  'extraVitrectomia', 'vitrectomia', 'demoSynthetic', 'demoSeed'
];
const ALERT_SETTINGS = Object.freeze({
  lensDelayWarn: 10,
  lensDelayCrit: 20,
  arrivedWarn: 15,
  arrivedCrit: 30,
  billingWarn: 15,
  billingCrit: 30
});

function parseArgs(argv) {
  const args = {
    fechaDemo: '2026-08-17', personas: 200, dosOjos: 150,
    seed: 20260817, output: DEFAULT_OUTPUT, report: DEFAULT_REPORT
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === '--fecha-demo') args.fechaDemo = val, i += 1;
    else if (key === '--personas') args.personas = Number(val), i += 1;
    else if (key === '--dos-ojos') args.dosOjos = Number(val), i += 1;
    else if (key === '--seed') args.seed = Number(val), i += 1;
    else if (key === '--output') args.output = path.resolve(val), i += 1;
    else if (key === '--report') args.report = path.resolve(val), i += 1;
    else if (key === '--help') {
      console.log('Uso: node scripts/generar-datos-demo.mjs [--fecha-demo YYYY-MM-DD] [--seed N] [--output archivo]');
      process.exit(0);
    }
  }
  return args;
}

function assert(condition, message) {
  if (!condition) throw new Error(`VALIDACION_DEMO: ${message}`);
}

function parseISO(value) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')), `fecha inválida: ${value}`);
  const d = new Date(`${value}T12:00:00Z`);
  assert(!Number.isNaN(d.getTime()), `fecha inválida: ${value}`);
  return d;
}

function iso(d) { return d.toISOString().slice(0, 10); }
function addDays(value, days) {
  const d = typeof value === 'string' ? parseISO(value) : new Date(value);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}
function daysBetween(a, b) { return Math.round((parseISO(a) - parseISO(b)) / 86400000); }
function clampDate(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
function pad(value, size = 4) { return String(value).padStart(size, '0'); }

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
  const first = pick(FIRST_NAMES, rnd);
  const last = pick(LAST_NAMES, rnd);
  return {
    personaId: `PAC-${pad(index)}`,
    nombre: `${first} ${last} Demo ${pad(index)}`,
    dni: String(99000000 + index),
    fnac: `${year}-${pad(month, 2)}-${pad(day, 2)}`,
    tel: `+54 9 000 000 ${pad(index, 4)}`,
    dir: `Calle Demo ${1000 + index}, Ciudad Académica`,
    obraSocial: 'PAMI',
    afiliado: String(990000000000 + index)
  };
}

function stageForDual(personIndex, eyeIndex) {
  if (eyeIndex === 0) {
    if (personIndex <= 100) return 'facturada';
    if (personIndex <= 120) return 'realizada';
    if (personIndex <= 135) return 'programada';
    if (personIndex <= 145) return 'llego';
    return 'esperando';
  }
  if (personIndex <= 45) return 'facturada';
  if (personIndex <= 60) return 'realizada';
  if (personIndex <= 75) return 'programada';
  if (personIndex <= 85) return 'llego';
  if (personIndex <= 95) return 'esperando';
  if (personIndex <= 100) return 'pedir';
  if (personIndex <= 110) return 'realizada';
  if (personIndex <= 120) return 'programada';
  if (personIndex <= 130) return 'llego';
  if (personIndex <= 140) return 'esperando';
  return 'pedir';
}

function stageForSingle(personIndex) {
  if (personIndex <= 170) return 'facturada';
  if (personIndex <= 175) return 'realizada';
  if (personIndex <= 180) return 'programada';
  if (personIndex <= 185) return 'llego';
  if (personIndex <= 195) return 'esperando';
  return 'pedir';
}

function historicalSurgeryDates(fechaDemo) {
  const dates = [];
  const end = parseISO(addDays(fechaDemo, -3));
  let cursor = parseISO('2026-01-01');
  while (cursor <= end) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth();
    for (const day of [6, 13, 20, 27]) {
      const candidate = new Date(Date.UTC(y, m, day, 12));
      if (candidate >= parseISO('2026-01-01') && candidate <= end) dates.push(iso(candidate));
    }
    cursor = new Date(Date.UTC(y, m + 1, 1, 12));
  }
  return dates.length ? dates : [addDays(fechaDemo, -3)];
}

function alertBand(index) { return ['normal', 'yellow', 'red'][index % 3]; }
function delayFor(stage, band) {
  const table = {
    esperando: { normal: 5, yellow: 15, red: 25 },
    llego: { normal: 5, yellow: 20, red: 35 },
    realizada: { normal: 5, yellow: 20, red: 35 }
  };
  return table[stage]?.[band] || 0;
}

function timeline(stage, index, fechaDemo, historyDates) {
  const minDate = '2026-01-01';
  const empty = {
    fechaSolLente: '', fechaLlegaLente: '', recepLente: '', fechaCir: '',
    hora: '', estadoCir: '', estadoFac: '', fechaFacturada: ''
  };
  if (stage === 'pedir') return { ...empty, stageDemo: 'pendiente_pedir_lente' };

  if (stage === 'esperando') {
    const band = alertBand(index);
    const request = clampDate(addDays(fechaDemo, -delayFor(stage, band)), minDate, fechaDemo);
    return { ...empty, fechaSolLente: request, stageDemo: `esperando_${band}` };
  }

  if (stage === 'llego') {
    const band = alertBand(index);
    const arrived = clampDate(addDays(fechaDemo, -delayFor(stage, band)), minDate, fechaDemo);
    const requested = clampDate(addDays(arrived, -12 - (index % 8)), minDate, arrived);
    return {
      ...empty, fechaSolLente: requested, fechaLlegaLente: arrived,
      recepLente: 'Correcta', stageDemo: `lente_recibida_${band}`
    };
  }

  if (stage === 'programada') {
    const cir = addDays(fechaDemo, [3, 7, 10, 14][index % 4]);
    const arrived = clampDate(addDays(fechaDemo, -(3 + index % 6)), minDate, fechaDemo);
    const requested = clampDate(addDays(arrived, -(12 + index % 7)), minDate, arrived);
    return {
      ...empty, fechaSolLente: requested, fechaLlegaLente: arrived,
      recepLente: 'Correcta', fechaCir: cir,
      hora: `${pad(8 + (index % 7), 2)}:${index % 2 ? '30' : '00'}`,
      stageDemo: 'cirugia_programada'
    };
  }

  if (stage === 'realizada') {
    const band = alertBand(index);
    const cir = clampDate(addDays(fechaDemo, -delayFor(stage, band)), minDate, fechaDemo);
    const arrived = clampDate(addDays(cir, -8), minDate, cir);
    const requested = clampDate(addDays(arrived, -(12 + index % 7)), minDate, arrived);
    return {
      ...empty, fechaSolLente: requested, fechaLlegaLente: arrived,
      recepLente: 'Correcta', fechaCir: cir,
      hora: `${pad(8 + (index % 7), 2)}:${index % 2 ? '30' : '00'}`,
      estadoCir: 'Realizada', stageDemo: `realizada_${band}_sin_facturar`
    };
  }

  const cir = historyDates[index % historyDates.length];
  const arrived = clampDate(addDays(cir, -(7 + index % 5)), minDate, cir);
  const requested = clampDate(addDays(arrived, -(12 + index % 8)), minDate, arrived);
  const invoiced = clampDate(addDays(cir, 1 + index % 4), cir, fechaDemo);
  return {
    ...empty, fechaSolLente: requested, fechaLlegaLente: arrived,
    recepLente: 'Correcta', fechaCir: cir,
    hora: `${pad(8 + (index % 7), 2)}:${index % 2 ? '30' : '00'}`,
    estadoCir: 'Realizada', estadoFac: 'FACTURADA', fechaFacturada: invoiced,
    stageDemo: 'facturada'
  };
}

function buildEpisode(person, personIndex, eye, eyeIndex, sequence, args, historyDates) {
  const stage = personIndex <= args.dosOjos
    ? stageForDual(personIndex, eyeIndex)
    : stageForSingle(personIndex);
  const dates = timeline(stage, sequence, args.fechaDemo, historyDates);
  const special = sequence % 7 === 0;
  const fechaCargaBase = dates.fechaSolLente || dates.fechaCir || addDays(args.fechaDemo, -(sequence % 120));
  const fechaCarga = clampDate(addDays(fechaCargaBase, -3), '2026-01-01', args.fechaDemo);
  return {
    id: `EPI-${person.personaId}-${eye}`,
    personaId: person.personaId,
    clinica: personIndex % 2 ? 'clinica_a' : 'clinica_b',
    nombre: person.nombre,
    dni: person.dni,
    fnac: person.fnac,
    tel: person.tel,
    dir: person.dir,
    obraSocial: person.obraSocial,
    afiliado: person.afiliado,
    ojos: personIndex <= args.dosOjos ? '2 ojos' : '1 ojo',
    ojo: eye,
    dioptria: `${17 + (sequence % 19) * 0.5}`,
    model: special ? 'LIO monofocal especial demo' : 'LIO monofocal estándar demo',
    precioEspecial: special ? 180000 + (sequence % 5) * 25000 : '',
    ...dates,
    fechaCarga,
    notas: special ? 'CASO SINTÉTICO DE DEMOSTRACIÓN — lente especial.' : 'CASO SINTÉTICO DE DEMOSTRACIÓN.',
    extraSutura: sequence % 13 === 0,
    extraInyeccion: sequence % 11 === 0,
    extraVitrectomia: false,
    vitrectomia: false,
    ecografiaImagen: '',
    ecografiaMes: '',
    facturarSeleccionado: false,
    demoSynthetic: true,
    demoSeed: args.seed,
    demoFecha: args.fechaDemo,
    createdAt: `${fechaCarga}T12:00:00.000Z`,
    updatedAt: `${args.fechaDemo}T12:00:00.000Z`
  };
}

function workflowState(row, allRows) {
  if (!row.dioptria) return 'FALTA_DIOPTRIA';
  if (!row.fechaSolLente) return 'PEDIR_LENTE';
  if (!row.fechaLlegaLente) return 'ESPERANDO_LENTE';
  if (!row.fechaCir) return 'LLEGO_LENTE_PROGRAMAR';
  if (row.estadoFac === 'FACTURADA') {
    if (row.ojos === '2 ojos') {
      const other = allRows.find(x => x.personaId === row.personaId && x.ojo !== row.ojo);
      return other ? 'FINALIZADA' : 'FACTURADA_FALTA_OTRO_OJO';
    }
    return 'FACTURADA';
  }
  return row.estadoCir === 'Realizada' || row.fechaCir < row.demoFecha
    ? 'REALIZADA_FALTA_FACTURAR'
    : 'FECHA_PROGRAMADA';
}

function alertFor(row, allRows, fechaDemo) {
  const state = workflowState(row, allRows);
  let days = 0;
  let warn = 0;
  let crit = 0;
  if (state === 'ESPERANDO_LENTE') {
    days = daysBetween(fechaDemo, row.fechaSolLente);
    warn = ALERT_SETTINGS.lensDelayWarn;
    crit = ALERT_SETTINGS.lensDelayCrit;
  } else if (state === 'LLEGO_LENTE_PROGRAMAR') {
    days = daysBetween(fechaDemo, row.fechaLlegaLente);
    warn = ALERT_SETTINGS.arrivedWarn;
    crit = ALERT_SETTINGS.arrivedCrit;
  } else if (state === 'REALIZADA_FALTA_FACTURAR') {
    days = daysBetween(fechaDemo, row.fechaCir);
    warn = ALERT_SETTINGS.billingWarn;
    crit = ALERT_SETTINGS.billingCrit;
  } else return '';
  if (days >= crit) return 'red';
  if (days >= warn) return 'yellow';
  return '';
}

function validateDataset(episodes, args) {
  const errors = [];
  const check = (condition, message) => { if (!condition) errors.push(message); };
  const expectedEpisodes = args.dosOjos * 2 + (args.personas - args.dosOjos);
  check(args.personas === 200, 'el alcance definitivo requiere 200 personas');
  check(args.dosOjos === 150, 'el alcance definitivo requiere 150 personas con dos ojos');
  check(episodes.length === expectedEpisodes && episodes.length === 350, 'deben existir exactamente 350 episodios');
  check(new Set(episodes.map(x => x.id)).size === episodes.length, 'hay IDs de episodio duplicados');
  const byPerson = new Map();
  for (const row of episodes) {
    for (const field of REQUIRED_FIELDS) check(Object.hasOwn(row, field), `${row.id}: falta ${field}`);
    check(row.demoSynthetic === true, `${row.id}: no está marcado como sintético`);
    check(/^EPI-PAC-\d{4}-(OD|OI)$/.test(row.id), `${row.id}: ID fuera del patrón demo`);
    check(/^PAC-\d{4}$/.test(row.personaId), `${row.id}: personaId inválido`);
    check(/^99\d{6}$/.test(row.dni), `${row.id}: DNI no pertenece al rango sintético`);
    check(/^\+54 9 000 000 \d{4}$/.test(row.tel), `${row.id}: teléfono no es ficticio controlado`);
    check(row.dir.includes('Ciudad Académica'), `${row.id}: dirección no es ficticia controlada`);
    check(CLINICS.has(row.clinica), `${row.id}: clínica inválida`);
    check(EYES.has(row.ojo), `${row.id}: ojo inválido`);
    check(row.extraVitrectomia === false && row.vitrectomia === false, `${row.id}: vitrectomía prohibida`);
    check(!JSON.stringify(row).includes(BLOCKED_PROJECT_ID), `${row.id}: referencia prohibida a ${BLOCKED_PROJECT_ID}`);
    check(Boolean(row.nombre && row.dni && row.fnac && row.tel && row.dir && row.obraSocial && row.afiliado), `${row.id}: datos personales incompletos`);
    check(Boolean(row.dioptria && row.model), `${row.id}: datos de lente incompletos`);
    if (row.fechaLlegaLente) check(row.fechaSolLente && row.fechaSolLente <= row.fechaLlegaLente, `${row.id}: llegada anterior a solicitud`);
    if (row.fechaCir) check(row.fechaLlegaLente && row.fechaLlegaLente <= row.fechaCir, `${row.id}: cirugía anterior a llegada`);
    if (row.estadoCir === 'Realizada') check(row.fechaCir && row.fechaCir <= args.fechaDemo, `${row.id}: cirugía realizada futura`);
    if (row.estadoFac === 'FACTURADA') check(row.fechaFacturada && row.fechaCir && row.fechaFacturada >= row.fechaCir && row.fechaFacturada <= args.fechaDemo, `${row.id}: facturación incoherente`);
    if (row.estadoFac !== 'FACTURADA') check(!row.fechaFacturada, `${row.id}: fecha facturada sin estado facturado`);
    if (!byPerson.has(row.personaId)) byPerson.set(row.personaId, []);
    byPerson.get(row.personaId).push(row);
  }
  check(byPerson.size === args.personas, `personas esperadas ${args.personas}, obtenidas ${byPerson.size}`);
  check(new Set([...byPerson.values()].map(rows => rows[0].dni)).size === args.personas, 'DNI repetido entre personas distintas');
  for (const [personId, rows] of byPerson) {
    const n = Number(personId.slice(-4));
    check(rows.length === (n <= args.dosOjos ? 2 : 1), `${personId}: cantidad de episodios incorrecta`);
    check(new Set(rows.map(x => x.ojo)).size === rows.length, `${personId}: ojo duplicado`);
    for (const key of ['nombre', 'dni', 'fnac', 'tel', 'dir', 'afiliado', 'clinica']) {
      check(new Set(rows.map(x => x[key])).size === 1, `${personId}: ${key} no coincide entre ojos`);
    }
  }
  if (errors.length) throw new Error(`VALIDACION_DEMO: ${errors.slice(0, 20).join(' | ')}${errors.length > 20 ? ` | +${errors.length - 20} errores` : ''}`);
  return { ok: true, checks: 24, errors: 0 };
}

function summarize(episodes, args, validation) {
  const byPerson = new Map();
  episodes.forEach(row => {
    if (!byPerson.has(row.personaId)) byPerson.set(row.personaId, []);
    byPerson.get(row.personaId).push(row);
  });
  const countBy = fn => episodes.reduce((acc, row) => {
    const key = fn(row);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const states = countBy(row => workflowState(row, episodes));
  const months = countBy(row => (row.fechaCir || row.fechaLlegaLente || row.fechaSolLente || row.fechaCarga).slice(0, 7));
  const alerts = countBy(row => alertFor(row, episodes, args.fechaDemo) || 'sin_alerta');
  const surgeryClinics = new Map();
  episodes.filter(x => x.fechaCir).forEach(row => {
    if (!surgeryClinics.has(row.fechaCir)) surgeryClinics.set(row.fechaCir, new Set());
    surgeryClinics.get(row.fechaCir).add(row.clinica);
  });
  const mixedDays = [...surgeryClinics.entries()].filter(([, clinics]) => clinics.size === 2).map(([date]) => date).sort();
  return {
    projectId: EXPECTED_PROJECT_ID,
    fecha_demo: args.fechaDemo,
    seed: args.seed,
    personas: byPerson.size,
    episodios: episodes.length,
    personasDosOjos: [...byPerson.values()].filter(x => x.length === 2).length,
    personasUnOjo: [...byPerson.values()].filter(x => x.length === 1).length,
    clinicas: countBy(row => row.clinica),
    ojos: countBy(row => row.ojo),
    estados: states,
    meses: Object.fromEntries(Object.entries(months).sort()),
    lentesEspeciales: episodes.filter(x => Number(x.precioEspecial) > 0).length,
    alertas: alerts,
    diasQuirurgicosMixtos: mixedDays,
    totalDiasQuirurgicosMixtos: mixedDays.length,
    vitrectomias: episodes.filter(x => x.extraVitrectomia || x.vitrectomia).length,
    datosReales: 0,
    validation
  };
}

function generate(args) {
  assert(args.personas === 200, 'personas debe ser 200 para la base definitiva');
  assert(args.dosOjos === 150, 'dos-ojos debe ser 150 para la base definitiva');
  assert(Number.isInteger(args.seed), 'seed debe ser entero');
  parseISO(args.fechaDemo);
  assert(args.fechaDemo >= '2026-01-04', 'fecha_demo debe permitir historial desde enero de 2026');
  const rnd = mulberry32(args.seed);
  const historyDates = historicalSurgeryDates(args.fechaDemo);
  const episodes = [];
  let sequence = 0;
  for (let personIndex = 1; personIndex <= args.personas; personIndex += 1) {
    const person = personData(personIndex, rnd);
    const eyes = personIndex <= args.dosOjos ? ['OD', 'OI'] : [personIndex % 2 ? 'OD' : 'OI'];
    eyes.forEach((eye, eyeIndex) => {
      sequence += 1;
      episodes.push(buildEpisode(person, personIndex, eye, eyeIndex, sequence, args, historyDates));
    });
  }
  const validation = validateDataset(episodes, args);
  const summary = summarize(episodes, args, validation);
  assert(summary.clinicas.clinica_a === 175 && summary.clinicas.clinica_b === 175, 'distribución de clínicas debe ser 175/175');
  assert(summary.ojos.OD === 175 && summary.ojos.OI === 175, 'distribución de ojos debe ser 175/175');
  assert(summary.alertas.yellow > 0 && summary.alertas.red > 0, 'deben existir alertas amarillas y rojas');
  assert(summary.totalDiasQuirurgicosMixtos >= 4, 'deben existir varios días quirúrgicos mixtos');
  return { episodes, summary };
}

const args = parseArgs(process.argv.slice(2));
const { episodes, summary } = generate(args);
fs.mkdirSync(path.dirname(args.output), { recursive: true });
fs.mkdirSync(path.dirname(args.report), { recursive: true });
fs.writeFileSync(args.output, `${JSON.stringify({ metadata: summary, episodes }, null, 2)}\n`, 'utf8');
fs.writeFileSync(args.report, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(summary, null, 2));

