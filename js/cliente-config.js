'use strict';

// PROYECTO FINAL TIG — ENTORNO DEMO AISLADO
// IMPORTANTE: este archivo NO debe apuntar nunca al proyecto Firebase de producción "cirugias-we".
// Hasta crear el Firebase exclusivo del Proyecto Final se usan valores deliberadamente inválidos.

export const CLIENT_CONFIG = {
  clienteId: 'proyecto_final_tig_demo',
  nombreSistema: 'Gestión de Cirugías de Cataratas - Proyecto Final TIG',
  nombreClinica: 'Grupo Oftalmológico Demo',
  dominioSugerido: '',
  emailTecnico: '',
  sedes: ['Clínica A', 'Clínica B'],
  obrasSociales: ['PAMI'],
  branding: {
    colorPrincipal: '#1d4ed8',
    logoUrl: ''
  },
  firebase: {
    apiKey: 'DEMO_NO_CONFIGURADO',
    authDomain: 'proyecto-final-tig-demo.invalid',
    projectId: 'proyecto-final-tig-demo-pendiente',
    storageBucket: 'proyecto-final-tig-demo-pendiente.invalid',
    messagingSenderId: '000000000000',
    appId: 'demo-no-configurado',
    measurementId: ''
  }
};
