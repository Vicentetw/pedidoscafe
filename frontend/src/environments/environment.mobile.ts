// Build para la app nativa (Capacitor/Android) — src/environments/environment.mobile.ts
//
// La app se instala en el celular como un paquete cerrado: los archivos de
// Angular quedan DENTRO del APK, pero igual necesita hablar por red con el
// backend (login, pedidos, todo). Por eso backendUrl NO puede quedar en ''
// (relativo) como en environment.ts — tiene que ser una URL absoluta que el
// celular pueda alcanzar.
//
// Apunta al backend de producción (Render). Requiere que CORS_ORIGINS en
// Render incluya `https://localhost` (origen del WebView de Capacitor en
// Android). Para probar contra un backend local, poner acá la IPv4 de la PC
// (`ipconfig`, adaptador Wi-Fi/Ethernet) con `http://<ip>:3001`, mismo
// Wi-Fi y el puerto abierto en el firewall (ver FASE_APP_MOVIL.md).
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
