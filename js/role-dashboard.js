'use strict';

import { DB, SETTINGS, WORKFLOW_KEYS, stateKey, alertas, getFechaFacturadaBase, applyAlertSettings } from './state.js';
import { currentRole, currentClinic, clinicLabel, canConfigureOperationalAlerts, isMedico } from './authz.js';
import { escapeHtml, escapeAttr, toast } from './utils.js';
import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const CLINICS = ['clinica_a', 'clinica_b'];
const FLOW = [
  [WORKFLOW_KEYS.PEDIR_LENTE, 'Pedir lente'],
  [WORKFLOW_KEYS.ESPERANDO_LENTE, 'Esperando lente'],
  [WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR, 'Lente recibida'],
  [WORKFLOW_KEYS.FECHA_PROGRAMADA, 'Programadas'],
  [WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR, 'Sin facturar']
];
const SETTINGS_FIELDS = [
  ['lens_delayed', 'Lente solicitada sin recibir', 'lens_delay_warn_days', 'lens_delay_crit_days'],
  ['no_schedule_after_arrival', 'Lente recibida sin programar', 'lens_arrived_not_scheduled_warn_days', 'lens_arrived_not_scheduled_crit_days'],
  ['billing_pending', 'Cirugía realizada sin facturar', 'billing_not_done_warn_days', 'billing_not_done_crit_days'],
  ['second_surgery_missing', 'Segundo ojo pendiente', 'second_eye_missing_warn_days', 'second_eye_missing_crit_days']
];

let filters = null;
let configLoaded = false;
let rendering = false;

function iso(value) { return String(value || '').slice(0, 10); }
function clinicOf(row) { return CLINICS.includes(String(row?.clinica || '')) ? row.clinica : ''; }
function factDate(row) { return iso(getFechaFacturadaBase(row)); }
function effectiveDate() {
  const demo = DB.rows.map(r => iso(r.demoFecha || r.fecha_demo)).filter(Boolean).sort().pop();
  return demo || new Date().toISOString().slice(0, 10);
}
function initialFilters() {
  const date = effectiveDate();
  return { mode: 'month', year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), clinic: '' };
}
function ensureFilters() { if (!filters) filters = initialFilters(); return filters; }
function periodLabel() {
  const f = ensureFilters();
  if (f.mode === 'year') return `Año ${f.year}`;
  if (f.mode === 'ytd') return `Acumulado ene–${MONTHS[f.month - 1]} ${f.year}`;
  return `${MONTHS[f.month - 1]} ${f.year}`;
}
function inPeriod(date) {
  const f = ensureFilters();
  if (!date || Number(date.slice(0, 4)) !== f.year) return false;
  const month = Number(date.slice(5, 7));
  return f.mode === 'month' ? month === f.month : f.mode === 'ytd' ? month <= f.month : true;
}
function scopedRows() {
  const f = ensureFilters();
  return DB.rows.filter(r => !f.clinic || clinicOf(r) === f.clinic);
}
function countByClinic(rows) {
  return { total: rows.length, a: rows.filter(r => clinicOf(r) === 'clinica_a').length, b: rows.filter(r => clinicOf(r) === 'clinica_b').length };
}
function metricCard(label, rows, tone = '', note = '') {
  const n = countByClinic(rows);
  return `<article class="rd-kpi ${tone}"><div class="rd-kpi-label">${escapeHtml(label)}</div><div class="rd-kpi-value">${n.total}</div><div class="rd-kpi-split"><span>Clínica A · ${n.a}</span><span>Clínica B · ${n.b}</span></div>${note ? `<div class="rd-kpi-note">${escapeHtml(note)}</div>` : ''}</article>`;
}
function header(title, summary) {
  const role = currentRole() === 'superadmin' ? 'Superadministración' : currentRole() === 'supervisor' ? 'Supervisión' : 'Médico';
  return `<section class="rd-hero"><div><div class="rd-eyebrow">${role} · ${currentClinic() === 'ambas' ? 'Ambas clínicas' : clinicLabel(currentClinic())}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(summary)}</p></div><div class="rd-asof">Datos al ${effectiveDate().split('-').reverse().join('/')}</div></section>`;
}
function filtersHtml() {
  const f = ensureFilters();
  return `<section class="rd-filters" aria-label="Filtros del resumen">
    <div class="rd-filter-group"><span>Período</span>
      <button class="rd-chip ${f.mode === 'month' ? 'active' : ''}" data-rd-mode="month">Mes</button>
      <button class="rd-chip ${f.mode === 'ytd' ? 'active' : ''}" data-rd-mode="ytd">Acumulado</button>
      <button class="rd-chip ${f.mode === 'year' ? 'active' : ''}" data-rd-mode="year">Año</button>
    </div>
    <div class="rd-filter-group"><button class="rd-nav" data-rd-shift="-1" aria-label="Período anterior">←</button><strong>${periodLabel()}</strong><button class="rd-nav" data-rd-shift="1" aria-label="Período siguiente">→</button></div>
    <label>Clínica<select id="rdClinic"><option value="">Ambas</option><option value="clinica_a" ${f.clinic === 'clinica_a' ? 'selected' : ''}>Clínica A</option><option value="clinica_b" ${f.clinic === 'clinica_b' ? 'selected' : ''}>Clínica B</option></select></label>
    <div class="rd-active-filter">Viendo: ${escapeHtml(periodLabel())} · ${f.clinic ? clinicLabel(f.clinic) : 'Ambas clínicas'}</div>
  </section>`;
}
function billedRows() { return scopedRows().filter(r => inPeriod(factDate(r))); }
function ytdRows() {
  const f = ensureFilters();
  return scopedRows().filter(r => { const d = factDate(r); return d && Number(d.slice(0,4)) === f.year && Number(d.slice(5,7)) <= f.month; });
}
function monthlySeries() {
  const f = ensureFilters();
  const demoDate = effectiveDate();
  const demoYear = Number(demoDate.slice(0, 4));
  const demoMonth = Number(demoDate.slice(5, 7));
  const visibleMonths = f.year < demoYear ? 12 : f.year === demoYear ? demoMonth : 0;
  return MONTHS.slice(0, visibleMonths).map((label, i) => {
    const prefix = `${f.year}-${String(i + 1).padStart(2,'0')}`;
    const rows = scopedRows().filter(r => factDate(r).startsWith(prefix));
    return { label: label.slice(0,3), month: i + 1, isCurrent: f.year === demoYear && i + 1 === demoMonth, ...countByClinic(rows) };
  });
}
function previousPeriodRows() {
  const f = ensureFilters();
  if (f.mode === 'month') {
    const date = new Date(f.year, f.month - 2, 1);
    const prefix = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,'0')}`;
    return scopedRows().filter(r => factDate(r).startsWith(prefix));
  }
  return scopedRows().filter(r => {
    const d = factDate(r);
    if (!d || Number(d.slice(0,4)) !== f.year - 1) return false;
    return f.mode === 'ytd' ? Number(d.slice(5,7)) <= f.month : true;
  });
}
function historyChart() {
  const f = ensureFilters();
  const demoDate = effectiveDate();
  const series = monthlySeries();
  const max = Math.max(1, ...series.map(v => v.total));
  const current = billedRows().length, previous = previousPeriodRows().length, delta = current - previous;
  const currentMonth = f.mode === 'month' && `${f.year}-${String(f.month).padStart(2,'0')}` === demoDate.slice(0,7);
  const comparison = currentMonth
    ? `${current} al ${demoDate.slice(8,10)}/${demoDate.slice(5,7)} · ${previous} en el mes anterior`
    : `${current} · ${delta >= 0 ? '+' : ''}${delta} vs período anterior`;
  const currentNote = series.some(v => v.isCurrent)
    ? `<div class="rd-chart-note">* ${MONTHS[Number(demoDate.slice(5,7)) - 1]} es el mes en curso, con datos al ${demoDate.split('-').reverse().join('/')}.</div>`
    : '';
  return `<section class="rd-panel rd-history"><div class="rd-section-head"><div><h2>Cirugías facturadas por mes</h2><p>Evolución mensual con comparación directa entre clínicas.</p></div><strong>${comparison}</strong></div><div class="rd-bars">${series.map(v => `<div class="rd-bar-col" title="${MONTHS[v.month - 1]}: ${v.total} · Clínica A ${v.a} · Clínica B ${v.b}"><span>${v.total || ''}</span><div class="rd-bar" style="height:${Math.max(v.total ? 8 : 1, (v.total/max)*150)}px"><i style="height:${v.total ? (v.a/v.total)*100 : 0}%"></i></div><small>${v.label}${v.isCurrent ? '*' : ''}</small></div>`).join('')}</div><div class="rd-legend"><span><i class="a"></i>Clínica A</span><span><i class="b"></i>Clínica B</span></div>${currentNote}</section>`;
}
function ytdPanel() {
  const n = countByClinic(ytdRows());
  return `<section class="rd-panel rd-ytd"><h2>Acumulado anual</h2><div class="rd-ytd-value">${n.total}</div><p>cirugías facturadas hasta ${MONTHS[ensureFilters().month - 1].toLowerCase()}</p><dl><div><dt>Clínica A</dt><dd>${n.a}</dd></div><div><dt>Clínica B</dt><dd>${n.b}</dd></div></dl></section>`;
}
function flowPanel() {
  const scoped = scopedRows();
  const values = FLOW.map(([key,label]) => ({ label, rows: scoped.filter(r => stateKey(r) === key) }));
  values.push({ label: `Facturadas · ${periodLabel()}`, rows: billedRows() });
  const max = Math.max(1, ...values.map(v => v.rows.length));
  return `<section class="rd-panel rd-flow"><div class="rd-section-head"><div><h2>Flujo quirúrgico actual</h2><p>Cartera activa por etapa; facturadas respeta el período seleccionado.</p></div></div>${values.map(v => { const n=countByClinic(v.rows); return `<div class="rd-flow-row"><div><strong>${escapeHtml(v.label)}</strong><span>${n.total}</span></div><div class="rd-track"><i style="width:${(n.total/max)*100}%"></i></div><small>A ${n.a} · B ${n.b}</small></div>`; }).join('')}</section>`;
}
function agendaPanel() {
  const today = effectiveDate();
  const rows = scopedRows().filter(r => stateKey(r) === WORKFLOW_KEYS.FECHA_PROGRAMADA && iso(r.fechaCir) >= today).sort((a,b) => `${iso(a.fechaCir)} ${a.hora||''}`.localeCompare(`${iso(b.fechaCir)} ${b.hora||''}`));
  const groups = new Map();
  rows.forEach(r => { const d=iso(r.fechaCir); if(!groups.has(d)) groups.set(d,[]); groups.get(d).push(r); });
  const content = [...groups].slice(0,8).map(([date, items]) => { const n=countByClinic(items); return `<details class="rd-agenda-day"><summary><span>${date.split('-').reverse().join('/')}</span><strong>${items.length} cirugías</strong><small>A ${n.a} · B ${n.b}</small></summary><div class="rd-table-wrap"><table><thead><tr><th>Hora</th><th>Paciente</th><th>DNI</th><th>Teléfono</th><th>Clínica</th><th>Ojo</th><th>Dioptría / lente</th></tr></thead><tbody>${items.map(r => `<tr><td>${escapeHtml(r.hora||'—')}</td><td>${escapeHtml(r.nombre||'—')}</td><td>${escapeHtml(r.dni||'—')}</td><td>${escapeHtml(r.tel||'—')}</td><td>${escapeHtml(clinicLabel(r.clinica))}</td><td>${escapeHtml(r.ojo||'—')}</td><td>${escapeHtml([r.dioptria,r.model||r.lio||r.modeloLente].filter(Boolean).join(' · ')||'—')}</td></tr>`).join('')}</tbody></table></div></details>`; }).join('');
  return `<section class="rd-panel rd-agenda"><div class="rd-section-head"><div><h2>Agenda quirúrgica combinada</h2><p>Próximas fechas. Abrí un día para ver únicamente los datos necesarios para la atención.</p></div><strong>${rows.length} próximas</strong></div>${content || '<div class="rd-empty">No hay cirugías programadas próximas con estos filtros.</div>'}</section>`;
}
function renderMedico() {
  const scoped = scopedRows();
  const by = key => scoped.filter(r => stateKey(r) === key);
  const critical = scoped.filter(r => alertas(r,{raw:true}).some(a => a.severity === 'red'));
  const billed = billedRows();
  return `${header('Panorama quirúrgico', `${billed.length} cirugías facturadas en ${periodLabel().toLowerCase()} y ${by(WORKFLOW_KEYS.FECHA_PROGRAMADA).length} actualmente programadas.`)}${filtersHtml()}
    <section class="rd-kpis">${metricCard('Programadas',by(WORKFLOW_KEYS.FECHA_PROGRAMADA),'')}${metricCard('Esperando lente',by(WORKFLOW_KEYS.ESPERANDO_LENTE),'')}${metricCard('Lente recibida',by(WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR),'')}${metricCard('Realizadas sin facturar',by(WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR),'warn')}${metricCard(`Facturadas · ${periodLabel()}`,billed,'good')}${metricCard('Demoras críticas',critical,'critical','Excepciones operativas')}</section>
    <div class="rd-grid two">${flowPanel()}${ytdPanel()}</div>${agendaPanel()}<div class="rd-grid two">${historyChart()}${secondEyeSummaryPanel()}</div>`;
}
function alertUniverses() {
  const scoped = scopedRows();
  const defs = [
    ['lens_delayed','Lente solicitada sin recibir',r => stateKey(r) === WORKFLOW_KEYS.ESPERANDO_LENTE],
    ['no_schedule_after_arrival','Lente recibida sin programar',r => stateKey(r) === WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR],
    ['billing_pending','Realizada sin facturar',r => stateKey(r) === WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR],
    ['second_surgery_missing','Segundo ojo pendiente',r => stateKey(r) === WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO]
  ];
  return defs.map(([type,label,pred]) => {
    const rows=scoped.filter(pred); let yellow=0, red=0;
    rows.forEach(r => { const a=alertas(r,{raw:true}).find(x=>x.type===type); if(a?.severity==='red') red++; else if(a?.severity==='yellow') yellow++; });
    return { type,label,total:rows.length,yellow,red,normal:Math.max(0,rows.length-yellow-red) };
  });
}
function exceptionPanel() {
  return `<section class="rd-panel rd-exceptions"><div class="rd-section-head"><div><h2>Excepciones por universo relevante</h2><p>Cada proporción se calcula sobre los casos que realmente pueden presentar esa demora.</p></div></div>${alertUniverses().map(v => `<div class="rd-exception-row"><div><strong>${escapeHtml(v.label)}</strong><span>${v.yellow+v.red} con alerta / ${v.total} casos</span></div><div class="rd-stacked"><i class="normal" style="width:${v.total?v.normal/v.total*100:100}%"></i><i class="yellow" style="width:${v.total?v.yellow/v.total*100:0}%"></i><i class="red" style="width:${v.total?v.red/v.total*100:0}%"></i></div><small>Normal ${v.normal} · Amarilla ${v.yellow} · Roja ${v.red}</small></div>`).join('')}</section>`;
}
function clinicComparison() {
  const scoped=scopedRows();
  const metrics=[
    ['Facturadas · período',r=>inPeriod(factDate(r))],['Programadas',r=>stateKey(r)===WORKFLOW_KEYS.FECHA_PROGRAMADA],['Esperando lente',r=>stateKey(r)===WORKFLOW_KEYS.ESPERANDO_LENTE],['Lente recibida',r=>stateKey(r)===WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR],['Sin facturar',r=>stateKey(r)===WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR],['Segundo ojo pendiente',r=>stateKey(r)===WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO],['Con alertas',r=>alertas(r,{raw:true}).length>0]
  ];
  return `<section class="rd-panel"><div class="rd-section-head"><div><h2>Comparación entre clínicas</h2><p>Misma definición para ambas sedes.</p></div></div><div class="rd-table-wrap"><table class="rd-compare"><thead><tr><th>Indicador</th><th>Clínica A</th><th>Clínica B</th><th>Diferencia</th></tr></thead><tbody>${metrics.map(([label,pred])=>{const rows=scoped.filter(pred),n=countByClinic(rows);return `<tr><td>${escapeHtml(label)}</td><td>${n.a}</td><td>${n.b}</td><td>${Math.abs(n.a-n.b)}</td></tr>`}).join('')}</tbody></table></div></section>`;
}
function secondEyePanel() {
  const rows=scopedRows().filter(r=>stateKey(r)===WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO).map(r=>({row:r,alert:alertas(r,{raw:true}).find(a=>a.type==='second_surgery_missing')})).sort((a,b)=>(b.alert?.days||0)-(a.alert?.days||0));
  const groups={red:rows.filter(x=>x.alert?.severity==='red'),yellow:rows.filter(x=>x.alert?.severity==='yellow'),recent:rows.filter(x=>!x.alert)};
  const block=(key,label)=>`<details class="rd-second-group" ${key==='red'&&groups[key].length?'open':''}><summary><span class="rd-dot ${key}"></span>${label}<strong>${groups[key].length}</strong></summary><div class="rd-table-wrap"><table><thead><tr><th>Paciente</th><th>Clínica</th><th>Ojo operado</th><th>Demora</th><th>Fecha base</th></tr></thead><tbody>${groups[key].map(({row,alert})=>`<tr><td>${escapeHtml(row.nombre||'—')}</td><td>${escapeHtml(clinicLabel(row.clinica))}</td><td>${escapeHtml(row.ojo||'—')}</td><td>${alert?`${alert.days} días`:'Dentro de plazo'}</td><td>${escapeHtml((factDate(row)||iso(row.fechaCir)||'—').split('-').reverse().join('/'))}</td></tr>`).join('')||'<tr><td colspan="5">Sin casos</td></tr>'}</tbody></table></div></details>`;
  return `<section class="rd-panel"><div class="rd-section-head"><div><h2>Segundo ojo</h2><p>Ordenado por mayor demora; detalle progresivo por severidad.</p></div><strong>${rows.length} pendientes</strong></div>${block('red','Atención inmediata')}${block('yellow','Seguimiento')}${block('recent','Recientes, dentro de plazo')}</section>`;
}
function secondEyeSummaryPanel() {
  const rows=scopedRows().filter(r=>stateKey(r)===WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO);
  const red=rows.filter(r=>alertas(r,{raw:true}).some(a=>a.type==='second_surgery_missing'&&a.severity==='red')).length;
  const yellow=rows.filter(r=>alertas(r,{raw:true}).some(a=>a.type==='second_surgery_missing'&&a.severity==='yellow')).length;
  const recent=Math.max(0,rows.length-red-yellow);
  return `<section class="rd-panel"><div class="rd-section-head"><div><h2>Seguimiento del segundo ojo</h2><p>Resumen agregado, sin exponer listados generales de pacientes.</p></div><strong>${rows.length} pendientes</strong></div><div class="rd-second-summary"><div><span class="rd-dot recent"></span><strong>${recent}</strong><small>Recientes</small></div><div><span class="rd-dot yellow"></span><strong>${yellow}</strong><small>Seguimiento</small></div><div><span class="rd-dot red"></span><strong>${red}</strong><small>Atención inmediata</small></div></div></section>`;
}
function settingsPanel() {
  if (!canConfigureOperationalAlerts()) return '';
  return `<details class="rd-panel rd-settings" id="rdSettings"><summary><div><h2>Umbrales de alertas operativas</h2><p>Configuración interna; no representa normativa de PAMI.</p></div><span>Configurar</span></summary><form id="rdSettingsForm"><div class="rd-settings-grid">${SETTINGS_FIELDS.map(([,label,warn,crit])=>`<fieldset><legend>${escapeHtml(label)}</legend><label>Amarilla desde<input type="number" min="1" max="364" name="${escapeAttr(warn)}" value="${SETTINGS[warn]}"> días</label><label>Roja desde<input type="number" min="2" max="365" name="${escapeAttr(crit)}" value="${SETTINGS[crit]}"> días</label></fieldset>`).join('')}</div><div class="rd-form-actions"><span id="rdSettingsStatus"></span><button class="btn primary" type="submit">Guardar umbrales</button></div></form></details>`;
}
function renderSupervisor() {
  const scoped=scopedRows();
  const by=key=>scoped.filter(r=>stateKey(r)===key);
  const red=scoped.filter(r=>alertas(r,{raw:true}).some(a=>a.severity==='red'));
  const yellow=scoped.filter(r=>alertas(r,{raw:true}).some(a=>a.severity==='yellow')&&!alertas(r,{raw:true}).some(a=>a.severity==='red'));
  const billed=billedRows();
  return `${header('Control operativo', `${red.length} casos críticos y ${yellow.length} en seguimiento. ${billed.length} cirugías facturadas en ${periodLabel().toLowerCase()}.`)}${filtersHtml()}
  <section class="rd-kpis supervisor">${metricCard('Alertas rojas',red,'critical')}${metricCard('Alertas amarillas',yellow,'warn')}${metricCard('Esperando lente',by(WORKFLOW_KEYS.ESPERANDO_LENTE))}${metricCard('Lente recibida sin programar',by(WORKFLOW_KEYS.LLEGO_LENTE_PROGRAMAR))}${metricCard('Programadas',by(WORKFLOW_KEYS.FECHA_PROGRAMADA))}${metricCard('Realizadas sin facturar',by(WORKFLOW_KEYS.REALIZADA_FALTA_FACTURAR),'warn')}${metricCard('Segundo ojo pendiente',by(WORKFLOW_KEYS.FACTURADA_FALTA_OTRO_OJO))}${metricCard(`Facturadas · ${periodLabel()}`,billed,'good')}</section>
  <div class="rd-grid two">${exceptionPanel()}${ytdPanel()}</div><div class="rd-grid two">${clinicComparison()}${historyChart()}</div><div class="rd-grid two">${flowPanel()}${secondEyePanel()}</div>${agendaPanel()}${settingsPanel()}`;
}
async function loadConfig() {
  if (configLoaded || !window.firestoreConnector) return;
  configLoaded=true;
  try {
    const snap=await getDoc(doc(window.firestoreConnector.getDb(),'configuracion','alertas_operativas'));
    if (snap.exists()) applyAlertSettings(snap.data());
  } catch(err) { console.warn('[dashboard] No se pudo leer configuracion/alertas_operativas:',err.message); }
}
async function saveConfig(form) {
  if (!canConfigureOperationalAlerts()) throw new Error('No tenés permisos para modificar alertas.');
  const values={}; SETTINGS_FIELDS.forEach(([, ,warn,crit])=>{values[warn]=Number(form.elements[warn].value);values[crit]=Number(form.elements[crit].value);});
  applyAlertSettings(values);
  const payload={...values,updatedAt:serverTimestamp(),updatedBy:String(window.CURRENT_USER?.uid||'')};
  await setDoc(doc(window.firestoreConnector.getDb(),'configuracion','alertas_operativas'),payload);
}
function bind(container) {
  container.onclick=e=>{
    const mode=e.target.closest('[data-rd-mode]')?.dataset.rdMode;
    if(mode){filters.mode=mode;renderRoleDashboard();return;}
    const shift=Number(e.target.closest('[data-rd-shift]')?.dataset.rdShift||0);
    if(shift){if(filters.mode==='month'){filters.month+=shift;if(filters.month<1){filters.month=12;filters.year--;}if(filters.month>12){filters.month=1;filters.year++;}}else filters.year+=shift;renderRoleDashboard();}
  };
  container.querySelector('#rdClinic')?.addEventListener('change',e=>{filters.clinic=e.target.value;renderRoleDashboard();});
  container.querySelector('#rdSettingsForm')?.addEventListener('submit',async e=>{e.preventDefault();const status=container.querySelector('#rdSettingsStatus');try{status.textContent='Guardando…';await saveConfig(e.currentTarget);status.textContent='Guardado en Firebase';toast('✓ Umbrales operativos actualizados');renderRoleDashboard();}catch(err){status.textContent=err.message;toast(err.message);}});
}

export async function renderRoleDashboard() {
  const container=document.getElementById('roleDashboardView');
  if(!container||rendering)return;
  rendering=true;
  ensureFilters();
  await loadConfig();
  container.innerHTML=`<main class="role-dashboard ${isMedico()?'medico':'supervisor'}">${isMedico()?renderMedico():renderSupervisor()}</main>`;
  bind(container);
  rendering=false;
}
