// Producción. Reemplazado en dev por environment.development.ts (ver angular.json).
// backendUrl se inyecta en el build de deploy; el firebaseConfig es público
// y por ahora apunta al mismo proyecto (restiapedidos).
export const environment = {
  production: true,
  backendUrl: 'https://pedidoscafe.onrender.com',
  apiKey: '',
  firebaseConfig: {
    apiKey: 'AIzaSyD0HJo5qbuhxy8r9xlrbGHmE8VuT7lA4yE',
    authDomain: 'restiapedidos.firebaseapp.com',
    projectId: 'restiapedidos',
    storageBucket: 'restiapedidos.firebasestorage.app',
    messagingSenderId: '46894321193',
    appId: '1:46894321193:web:2e691dfa5fc929a1551638',
  },
};
