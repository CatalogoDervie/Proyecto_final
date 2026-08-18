'use strict';

// Autorización centralizada: nunca se decide por email, solo por perfil validado.
export const CLINICS = Object.freeze({ A: 'clinica_a', B: 'clinica_b' });
const ROLES = new Set(['superadmin', 'supervisor', 'medico', 'administrativo']);

export function normalizeClinic(value) {
  const v = String(value || '').trim().toLowerCase();
  if (['clinica_a', 'clínica a', 'clinica a', 'a', 'cdu', 'clínica 1', 'clinica 1'].includes(v)) return CLINICS.A;
  if (['clinica_b', 'clínica b', 'clinica b', 'b', 'gualeguaychu', 'gualeguaychú', 'clínica 2', 'clinica 2'].includes(v)) return CLINICS.B;
  return '';
}
export function clinicLabel(value) { return normalizeClinic(value) === CLINICS.A ? 'Clínica A' : normalizeClinic(value) === CLINICS.B ? 'Clínica B' : '—'; }
export function currentUser() { return window.CURRENT_USER || { uid:'', email:'', profile:{} }; }
export function currentRole() { const r = String(currentUser()?.profile?.role || '').trim().toLowerCase(); return ROLES.has(r) ? r : 'usuario'; }
export function currentClinic() { const c = String(currentUser()?.profile?.clinica || '').trim().toLowerCase(); return c === 'ambas' ? 'ambas' : normalizeClinic(c); }
export function isActiveUser() { return currentUser()?.profile?.active === true; }
export function isSuperAdmin() { return isActiveUser() && currentRole() === 'superadmin'; }
export function isSupervisor() { return isActiveUser() && currentRole() === 'supervisor'; }
export function isMedico() { return isActiveUser() && currentRole() === 'medico'; }
export function isAdministrativo() { return isActiveUser() && currentRole() === 'administrativo'; }
export function canViewClinic(clinic) { const c = normalizeClinic(clinic); return !!c && (isSuperAdmin() || isSupervisor() || isMedico() || (isAdministrativo() && currentClinic() === c)); }
export function canEditClinic(clinic) { const c = normalizeClinic(clinic); return !!c && (isSuperAdmin() || isSupervisor() || (isAdministrativo() && currentClinic() === c)); }
export function allowedClinics() { return (isSuperAdmin() || isSupervisor() || isMedico()) ? [CLINICS.A, CLINICS.B] : isAdministrativo() ? [currentClinic()] : []; }
export function defaultClinic() { return isAdministrativo() ? currentClinic() : CLINICS.A; }
export function canEditPatient(clinic) { return clinic ? canEditClinic(clinic) : (isAdministrativo() || isSupervisor() || isSuperAdmin()); }
export function canFacturar() { return isAdministrativo() || isSupervisor() || isSuperAdmin(); }
export function canManageUsers() { return isSuperAdmin(); }
export function canConfigure() { return isSuperAdmin(); }
export function canDelete() { return isSuperAdmin(); }
export function canExport() { return isAdministrativo() || isSupervisor() || isSuperAdmin(); }
export function canViewAudit() { return isSupervisor() || isSuperAdmin(); }
export function canViewRowHistory() { return isSupervisor() || isSuperAdmin(); }
export function canView(tab = '') {
  if (!isActiveUser()) return false;
  if (tab === 'administracion') return canManageUsers();
  if (['tabla','pedirlente','whatsapp','facturar'].includes(tab)) return canFacturar();
  if (['kanban','estadisticas'].includes(tab)) return isSupervisor() || isSuperAdmin();
  return false;
}
