// facturar.js — vista operativa de facturación (sin prácticas excluidas)

'use strict';

import { DB, getDioptria, filtered, WORKFLOW_KEYS, isDemoSynthetic } from './state.js';
import { save } from './firebase-ui.js';
import { connectorStartJob, connectorPollJob, renderJobStatus } from './connector.js';
import { hoyISO, toast, escapeHtml, escapeAttr } from './utils.js';
import { saveWithAudit } from './audit.js';
import { canEditClinic, clinicLabel } from './authz.js';

const LS_BASE = 'facturar_base_dir';
const LS_OUT = 'facturar_output_dir';

function clone(value) { return JSON.parse(JSON.stringify(value || {})); }
function getBaseDir() { return localStorage.getItem(LS_BASE) || ''; }
function getOutputDir() { return localStorage.getItem(LS_OUT) || ''; }

function normalizeHoraText(value) {
  let text = String(value || '').trim().replace('.', ':').replace(/[^0-9:]/g, '');
  if (!text) return '';
  if (/^\d{1,2}$/.test(text)) text = `${text.padStart(2, '0')}:00`;
  else if (/^\d{3,4}$/.test(text)) text = `${text.slice(0, -2).padStart(2, '0')}:${text.slice(-2)}`;
  const match = text.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return text;
  const hour = Math.min(Math.max(parseInt(match[1], 10) || 0, 0), 23);
  const minute = Math.min(Math.max(parseInt(match[2], 10) || 0, 0), 59);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseDateToISO(value) {
  const text = String(value || '').trim().slice(0, 10);
  if (!text) return '';
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) return `${match[3]}-${String(parseInt(match[2], 10)).padStart(2, '0')}-${String(parseInt(match[1], 10)).padStart(2, '0')}`;
  match = text.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return text;
}

function displayDate(value) {
  const iso = parseDateToISO(value);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || '');
}

function billingDateFor(row) {
  return parseDateToISO(row.fechaFacturacion || row.fechaFacturada || '') || hoyISO();
}

function rowsFacturar() {
  return filtered({
    includeQuickFilter: false,
    includeEstadoSelect: false,
    stateKeys: [WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR]
  })
    .filter(row => canEditClinic(row.clinica))
    .slice()
    .sort((a, b) => String(a.fechaCir || '').localeCompare(String(b.fechaCir || ''))
      || String(a.hora || a.hora_cirugia || '').localeCompare(String(b.hora || b.hora_cirugia || ''))
      || String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' }));
}

function selectedFacturarRows() {
  return rowsFacturar().filter(row => row.facturarSeleccionado === true);
}

function buildPacientePayload(row) {
  const billingDate = billingDateFor(row);
  return {
    id: String(row.id || ''),
    nombre_completo: String(row.nombre || '').trim(),
    dni: String(row.dni || '').trim(),
    afiliado: String(row.afiliado || '').trim(),
    fecha: billingDate,
    fecha_facturacion: billingDate,
    hora: normalizeHoraText(row.hora || row.hora_cirugia || ''),
    ojo_operado: String(row.ojo || '').trim().toUpperCase(),
    dioptria: String(getDioptria(row) || '').trim(),
    facturar: true,
    clinica: String(row.clinica || '').trim(),
    obra_social: String(row.obraSocial || '').trim(),
    generar: { ARM_Y_AV: true, HC: true, PROTOCOLO: true }
  };
}

function validateRows(rows) {
  return rows.map(row => {
    const missing = [];
    const coverage = String(row.obraSocial || row.obra_social || '').trim().toUpperCase();
    if (!String(row.nombre || row.nombre_completo || '').trim()) missing.push('nombre');
    if (!String(row.dni || '').trim()) missing.push('DNI');
    if (coverage !== 'PARTICULAR' && !String(row.afiliado || '').trim()) missing.push('afiliado');
    if (!String(row.ojo || row.ojo_operado || '').trim()) missing.push('ojo');
    if (!String(getDioptria(row) || row.dioptria || row.lio || '').trim()) missing.push('dioptría');
    if (!String(row.fechaCir || row.fecha_cirugia || row.fecha || '').trim()) missing.push('fecha cirugía');
    if (!String(row.hora || row.hora_cirugia || row.horaCirugia || '').trim()) missing.push('hora');
    if (!billingDateFor(row)) missing.push('fecha facturación');
    return { row, missing };
  }).filter(item => item.missing.length);
}

async function setFacturar(row, checked) {
  if (!canEditClinic(row.clinica)) { toast('No tenés permisos para facturar esta clínica'); return; }
  const before = clone(row);
  row.facturarSeleccionado = checked === true;
  await saveWithAudit(before, row, { modulo: 'Facturar', accion: 'MARCAR_FACTURAR' });
  renderRows();
}

async function setHora(row, value) {
  if (!canEditClinic(row.clinica)) { toast('No tenés permisos para facturar esta clínica'); return; }
  const before = clone(row);
  row.hora = normalizeHoraText(value);
  row.hora_cirugia = row.hora;
  await saveWithAudit(before, row, { modulo: 'Facturar', accion: 'CAMBIAR_HORA_FACTURACION' });
  renderRows();
}

async function setFechaFacturacion(row, value) {
  if (!canEditClinic(row.clinica)) { toast('No tenés permisos para facturar esta clínica'); return; }
  const before = clone(row);
  row.fechaFacturacion = parseDateToISO(value) || hoyISO();
  await saveWithAudit(before, row, { modulo: 'Facturar', accion: 'CAMBIAR_FECHA_FACTURACION' });
  renderRows();
}

async function selectAllRows(checked) {
  for (const row of rowsFacturar()) {
    row.facturarSeleccionado = checked === true;
    await save(row);
  }
  renderRows();
}

function renderRows() {
  const tbody = document.getElementById('facturarTbody');
  if (!tbody) return;
  const rows = rowsFacturar();
  tbody.innerHTML = rows.length ? rows.map(row => `
    <tr>
      <td class="facturar-check"><input type="checkbox" class="facturar-row" data-id="${escapeAttr(row.id)}" ${row.facturarSeleccionado ? 'checked' : ''}></td>
      <td><input class="facturar-fecha" data-id="${escapeAttr(row.id)}" type="text" inputmode="numeric" maxlength="10" placeholder="dd/mm/aaaa" value="${escapeAttr(displayDate(billingDateFor(row)))}"></td>
      <td><input class="facturar-hora" data-id="${escapeAttr(row.id)}" type="text" inputmode="numeric" maxlength="5" placeholder="09:30" value="${escapeAttr(row.hora || row.hora_cirugia || '')}"></td>
      <td class="facturar-paciente"><strong>${escapeHtml(row.nombre || '—')}</strong><div>${escapeHtml(clinicLabel(row.clinica))}</div></td>
      <td>${escapeHtml(row.dni || '—')}</td>
      <td>${escapeHtml(row.obraSocial || '—')}${row.afiliado ? `<div class="cell-sub">Af. ${escapeHtml(row.afiliado)}</div>` : ''}</td>
      <td>${escapeHtml(row.ojo || '—')}</td>
      <td>${escapeHtml(getDioptria(row) || '—')}</td>
    </tr>`).join('') : '<tr><td colspan="8"><div class="empty">No hay pacientes para facturar con los filtros actuales.</div></td></tr>';

  const selected = rows.filter(row => row.facturarSeleccionado === true).length;
  const count = document.getElementById('facturarCount');
  const selectedCount = document.getElementById('facturarSelected');
  if (count) count.textContent = String(rows.length);
  if (selectedCount) selectedCount.textContent = String(selected);
  const checkAll = document.getElementById('facturarChkAll');
  if (checkAll) checkAll.checked = rows.length > 0 && selected === rows.length;

  tbody.querySelectorAll('.facturar-row').forEach(input => input.addEventListener('change', event => {
    const row = DB.rows.find(item => String(item.id) === String(event.target.dataset.id));
    if (row) setFacturar(row, event.target.checked);
  }));
  tbody.querySelectorAll('.facturar-hora').forEach(input => {
    input.addEventListener('blur', event => {
      const row = DB.rows.find(item => String(item.id) === String(event.target.dataset.id));
      if (row) setHora(row, event.target.value);
    });
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } });
  });
  tbody.querySelectorAll('.facturar-fecha').forEach(input => {
    input.addEventListener('blur', event => {
      const row = DB.rows.find(item => String(item.id) === String(event.target.dataset.id));
      if (row) setFechaFacturacion(row, event.target.value);
    });
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } });
  });
}

async function ejecutarFacturacionDocs() {
  const rows = selectedFacturarRows();
  if (!rows.length) { toast('Tildá Facturar en al menos un paciente'); return; }
  if (rows.some(row => !canEditClinic(row.clinica))) { toast('La selección contiene una clínica sin permiso de escritura'); return; }

  const invalid = validateRows(rows);
  if (invalid.length) {
    const detail = invalid.map(item => `${item.row.nombre || 'Paciente sin nombre'}: falta ${item.missing.join(', ')}`).join(' · ');
    renderJobStatus('facturarJobStatus', 'err', `❌ ${detail}`);
    toast(`Hay ${invalid.length} paciente(s) con datos incompletos.`);
    return;
  }

  const summary = rows.map(row => `• ${row.nombre || '—'} · ${row.ojo || '—'} · Factura: ${billingDateFor(row)} ${row.hora || row.hora_cirugia || ''}`).join('\n');
  if (!confirm(`Se va a generar documentación y facturar ${rows.length} paciente(s):\n\n${summary}`)) return;

  if (rows.some(isDemoSynthetic)) {
    toast('BASE DEMO: validación completada; conector real no ejecutado');
    renderJobStatus('facturarJobStatus', 'err', '⛔ Datos sintéticos: no se envían a conectores reales ni se cambia su estado.');
    return;
  }

  const baseDir = getBaseDir() || 'AUTO';
  const outputDir = getOutputDir() || 'AUTO_SALIDA';
  const pacientes = rows.map(buildPacientePayload);
  const payload = { base_dir: baseDir, output_dir: outputDir, source: 'github_facturar_tab', pacientes };
  const button = document.getElementById('facturarRun');
  if (button) { button.disabled = true; button.textContent = '⏳ Ejecutando...'; }
  renderJobStatus('facturarJobStatus', 'run', `⏳ Enviando ${pacientes.length} paciente(s) al conector local...`);

  try {
    const jobId = await connectorStartJob('facturar_docs', payload);
    renderJobStatus('facturarJobStatus', 'run', `⏳ Job iniciado: ${String(jobId).slice(0, 8)}`);
    const result = await connectorPollJob(jobId, status => renderJobStatus('facturarJobStatus', 'run', `⏳ Ejecutando${status?.done != null ? ` (${status.done}/${status.total ?? pacientes.length})` : ''}`));
    for (const row of rows) {
      const before = clone(row);
      const billingDate = billingDateFor(row);
      row.estadoFac = 'FACTURADA';
      row.fechaFacturada = billingDate;
      row.fechaFacturacion = billingDate;
      row.facturarSeleccionado = false;
      await saveWithAudit(before, row, { modulo: 'Facturar', accion: 'MARCAR_FACTURADA', detalle: `Marcó FACTURADA en ${billingDate}` });
    }
    renderJobStatus('facturarJobStatus', 'ok', `✅ Documentación generada. Carpeta: ${result?.output_dir || outputDir}`);
    toast('✅ Documentación generada y facturación guardada');
    renderRows();
  } catch (error) {
    const message = String(error?.message || 'Error ejecutando facturación documental');
    renderJobStatus('facturarJobStatus', /conector local no detectado|no se pudo conectar/i.test(message) ? 'off' : 'err', `❌ ${message}`);
    toast(`❌ ${message}`);
  } finally {
    if (button) { button.disabled = false; button.textContent = '▶ Generar documentación y facturar'; }
  }
}

function attachEvents() {
  document.getElementById('facturarRefresh')?.addEventListener('click', renderRows);
  document.getElementById('facturarClearSel')?.addEventListener('click', () => selectAllRows(false));
  document.getElementById('facturarSelectAll')?.addEventListener('click', () => selectAllRows(true));
  document.getElementById('facturarChkAll')?.addEventListener('change', event => selectAllRows(event.target.checked));
  document.getElementById('facturarRun')?.addEventListener('click', ejecutarFacturacionDocs);
  document.getElementById('facturarBack')?.addEventListener('click', () => document.querySelector('.tablink[data-tab="tabla"]')?.click());
}

export function renderFacturar() {
  const container = document.getElementById('facturarView');
  if (!container) return;
  container.innerHTML = `
    <div class="facturar-shell">
      <div class="facturar-head">
        <div>
          <h3 class="facturar-title">Facturar</h3>
          <div class="facturar-sub">Pacientes de la clínica autorizada en <strong>REALIZADA - FALTA FACTURAR</strong>.</div>
        </div>
        <div class="facturar-counters"><span><strong id="facturarCount">0</strong> visibles</span><span><strong id="facturarSelected">0</strong> tildados</span></div>
      </div>
      <div class="facturar-actions">
        <button id="facturarRun" class="btn primary">▶ Generar documentación y facturar</button>
        <button id="facturarSelectAll" class="btn">Tildar pacientes</button>
        <button id="facturarClearSel" class="btn">Destildar pacientes</button>
        <button id="facturarRefresh" class="btn">↺ Actualizar</button>
        <button id="facturarBack" class="btn">← Volver</button>
      </div>
      <div id="facturarJobStatus" class="facturar-status">Listo para validar la facturación.</div>
      <div class="tablewrap facturar-tablewrap"><div class="table-scroll"><table class="wa-table facturar-table"><thead><tr><th><input id="facturarChkAll" type="checkbox"><br>Facturar</th><th>Fecha facturación</th><th>Hora</th><th>Paciente</th><th>DNI</th><th>Cobertura / obra social</th><th>Ojo</th><th>Dioptría</th></tr></thead><tbody id="facturarTbody"></tbody></table></div></div>
    </div>`;
  attachEvents();
  renderRows();
}
