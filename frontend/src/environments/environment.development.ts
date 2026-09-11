// Desarrollo local. El apiKey de Firebase es público (viaja en el bundle).
// Proyecto: restiapedidos. App web: pedidoscofee-web.
export const environment = {
  production: false,
  backendUrl: 'http://localhost:3001',
  apiKey: '', // el mismo valor que API_KEY del .env del backend (vacío = no se exige)
  firebaseConfig: {
    apiKey: 'AIzaSyD0HJo5qbuhxy8r9xlrbGHmE8VuT7lA4yE',
    authDomain: 'restiapedidos.firebaseapp.com',
    projectId: 'restiapedidos',
    storageBucket: 'restiapedidos.firebasestorage.app',
    messagingSenderId: '46894321193',
    appId: '1:46894321193:web:2e691dfa5fc929a1551638',
  },
};
