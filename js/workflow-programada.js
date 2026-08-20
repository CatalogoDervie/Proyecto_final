// Definición canónica y pura de FECHA_PROGRAMADA.

'use strict';

export const PROGRAMMED_UNTIL_FIELD = 'programadaHastaDia';
export const PROGRAMMED_TIME_ZONE = 'America/Argentina/Cordoba';

function text(value) { return String(value ?? '').trim(); }
function upper(value) {
  return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}
function validISODate(value) {
  const raw = text(value).slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return date.toISOString().slice(0, 10) === raw ? raw : '';
}

export function argentinaDateISO(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PROGRAMMED_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function argentinaDayKey(now = new Date()) {
  return Number(argentinaDateISO(now).replaceAll('-', ''));
}

export function isFechaProgramadaWorkflow(row, referenceDate = argentinaDateISO()) {
  if (!row || upper(row.recepLente) === 'DEVOLVER') return false;
  if (!text(row.dioptria || row.lio)) return false;
  if (!validISODate(row.fechaSolLente) || !validISODate(row.fechaLlegaLente)) return false;
  const fechaCir = validISODate(row.fechaCir);
  const today = validISODate(referenceDate);
  if (!fechaCir || !today || fechaCir < today) return false;
  if (upper(row.estadoCir) === 'REALIZADA') return false;
  if (['FACTURADA', 'FINALIZADA'].includes(upper(row.estadoFac))) return false;
  return true;
}

export function programadaHastaDia(row, referenceDate = argentinaDateISO()) {
  if (!isFechaProgramadaWorkflow(row, referenceDate)) return null;
  const [year, month, day] = validISODate(row.fechaCir).split('-').map(Number);
  return Number(new Date(Date.UTC(year, month - 1, day + 1, 12)).toISOString().slice(0, 10).replaceAll('-', ''));
}

export function isSharedProgrammedProjection(row, now = new Date()) {
  const untilDay = Number(row?.[PROGRAMMED_UNTIL_FIELD]);
  return Number.isInteger(untilDay)
    && untilDay > argentinaDayKey(now)
    && isFechaProgramadaWorkflow(row, argentinaDateISO(now));
}

export function millisecondsUntilNextArgentinaDay(now = new Date()) {
  const today = argentinaDateISO(now);
  const [year, month, day] = today.split('-').map(Number);
  const nextMidnight = Date.UTC(year, month - 1, day + 1, 3, 0, 1);
  return Math.max(1000, nextMidnight - now.getTime());
}
