// Actualización controlada del dataset ficticio. No modifica usuarios ni reglas.
import { DB, setDB, alertas } from './state.js';
import { hoyISO, downloadTextFile, toast } from './utils.js';
import { canManageUsers } from './authz.js';
import { sincronizarAhora } from './firebase-ui.js';
import { programadaHastaDia } from './workflow-programada.js';
import { collection, doc, getDocsFromServer, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

const PROJECT = 'proyecto-final-tig';
const SUPERADMIN = 'oyVbmO40aqSIK9pCXihU4cOL2bS2';
let running = false;
function check(value, message) { if (!value) throw new Error(message); }
function synthetic(row) {
  return row?.demoSynthetic === true && /^99\d{6}$/.test(String(row.dni))
    && /^EPI-PAC-\d{4}-(OD|OI)$/.test(String(row.id))
    && ['clinica_a','clinica_b'].includes(row.clinica);
}
function counts(rows) {
  const previous = DB;
  try {
    setDB({rows,nid:previous.nid});
    const groups=rows.map(row=>alertas(row,{raw:true}));
    return {red:groups.filter(a=>a.some(x=>x.severity==='red')).length,
      yellow:groups.filter(a=>!a.some(x=>x.severity==='red')&&a.some(x=>x.severity==='yellow')).length};
  } finally { setDB(previous); }
}

export async function importarDatasetDemo(payload) {
  check(!running,'Ya hay una actualización en curso.');
  check(canManageUsers(),'Esta actualización requiere superadministrador.');
  const connector=window.firestoreConnector, db=connector?.getDb?.();
  check(db?.app?.options?.projectId===PROJECT,'La actualización solo está habilitada en proyecto-final-tig.');
  check(connector.getAuth()?.currentUser?.uid===SUPERADMIN,'La cuenta activa no es el superadministrador de la demo.');
  const meta=payload.metadata,rows=payload.episodes;
  check(meta?.projectId===PROJECT && meta.perfil==='defensa','Se requiere un dataset de defensa para este proyecto.');
  check(meta.fecha_demo===hoyISO(),'Generá el dataset con la fecha de hoy antes de actualizar.');
  check(Array.isArray(rows)&&rows.length===meta.episodios&&rows.length>=500,'El volumen del dataset es inválido.');
  check(new Set(rows.map(r=>r.id)).size===rows.length,'El archivo contiene identificadores duplicados.');
  check(rows.every(r=>synthetic(r)&&r.demoFecha===meta.fecha_demo),'El archivo debe contener únicamente los registros ficticios de esta demo.');
  const measured=counts(rows);
  check(measured.red===1&&measured.yellow===4,'Las fechas y los umbrales vigentes no generan exactamente 4 alertas de seguimiento y 1 crítica.');
  check(!(connector.pendingCount?.()),'Sincronizá los cambios pendientes antes de actualizar.');
  running=true;
  try {
    const previousSnap=await getDocsFromServer(collection(db,'cirugias'));
    const previous=previousSnap.docs.map(d=>({id:d.id,...d.data()}));
    check(previous.every(synthetic),'La base contiene registros ajenos al dataset ficticio. No se actualizó nada.');
    const nextIds=new Set(rows.map(r=>r.id));
    check(previous.every(r=>nextIds.has(r.id)),'El nuevo dataset dejaría registros anteriores fuera de la actualización. No se actualizó nada.');
    const beforeById=new Map(previous.map(r=>[r.id,r]));
    const added=rows.filter(r=>!beforeById.has(r.id)).length;
    const date=meta.fecha_demo.split('-').reverse().join('/');
    if (!confirm(`¿Actualizar la base ficticia al ${date}?\n\n${previous.length} episodios existentes y ${added} nuevos.\nResultado previsto: 4 alertas de seguimiento y 1 crítica.\n\nSe descargará un respaldo antes de guardar. Se conservan las cuentas y los permisos.`)) return;
    downloadTextFile(`Respaldo_PFC_antes_${meta.fecha_demo}.json`,JSON.stringify({metadata:{projectId:PROJECT,exportedAt:new Date().toISOString()},rows:previous},null,2),'application/json');
    for (let offset=0;offset<rows.length;offset+=400) {
      const batch=writeBatch(db);
      for (const row of rows.slice(offset,offset+400)) {
        const next={...row,createdAt:beforeById.get(row.id)?.createdAt||row.createdAt,
          updatedAt:new Date().toISOString(),programadaHastaDia:programadaHastaDia(row),_srv:serverTimestamp()};
        batch.set(doc(db,'cirugias',row.id),next,{merge:true});
      }
      await batch.commit();
      toast(`Actualizando datos ficticios: ${Math.min(offset+400,rows.length)} de ${rows.length}`);
    }
    const verified=await getDocsFromServer(collection(db,'cirugias'));
    const loaded=verified.docs.map(d=>({id:d.id,...d.data()}));
    const loadedById=new Map(loaded.map(r=>[r.id,r]));
    check(loaded.length===rows.length && loaded.every(synthetic),'La comprobación final detectó una diferencia de volumen. Conservá el respaldo.');
    for (const expected of rows) {
      const actual=loadedById.get(expected.id);
      check(actual && Object.entries(expected).every(([key,value])=>['createdAt','updatedAt','programadaHastaDia'].includes(key)||JSON.stringify(actual[key])===JSON.stringify(value)),`No se pudo verificar el episodio ${expected.id}. Conservá el respaldo.`);
    }
    const result=counts(loaded);
    check(result.red===1&&result.yellow===4,'La comprobación de alertas no coincide. Conservá el respaldo.');
    await sincronizarAhora();
    toast(`✓ Base actualizada al ${date}: ${loaded.length} episodios, 4 alertas de seguimiento y 1 crítica`);
    return {episodios:loaded.length,...result};
  } finally { running=false; }
}
