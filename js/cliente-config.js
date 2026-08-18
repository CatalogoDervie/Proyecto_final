'use strict';

// PROYECTO FINAL TIG — ENTORNO DEMO AISLADO
// IMPORTANTE: este archivo NO debe apuntar nunca al proyecto Firebase de producción "cirugias-we".

export const CLIENT_CONFIG = {
  clienteId: 'clinica_oftalmologica',
  nombreSistema: 'Gestión de Cirugías de Cataratas - Proyecto Final TIG',
  nombreClinica: 'Clínica Oftalmológica',
  dominioSugerido: '',
  emailTecnico: '',
  sedes: ['Clínica A', 'Clínica B'],
  obrasSociales: ['PAMI'],
  branding: {
    colorPrincipal: '#1d4ed8',
    logoUrl: ''
  },
  firebase: {
    apiKey: 'AIzaSyB93k9Z_A08t6Vy3pTw24u0TBpiTqgxZyA',
    authDomain: 'proyecto-final-tig.firebaseapp.com',
    projectId: 'proyecto-final-tig',
    storageBucket: 'proyecto-final-tig.firebasestorage.app',
    messagingSenderId: '495638874753',
    appId: '1:495638874753:web:f7ede2514a3e18ce159b80',
    measurementId: 'G-HWY7FWS9W4'
  }
};
