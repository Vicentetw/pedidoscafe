// Build para la app nativa (Capacitor/Android) — src/environments/environment.mobile.ts
//
// La app se instala en el celular como un paquete cerrado: los archivos de
// Angular quedan DENTRO del APK, pero igual necesita hablar por red con el
// backend (login, pedidos, todo). Por eso backendUrl NO puede quedar en ''
// (relativo) como en environment.ts — tiene que ser una URL absoluta que el
// celular pueda alcanzar.
//
// Server.local (el valor de acá) es la IP de esta PC en su red — sólo
// sirve mientras el celular esté en el MISMO Wi-Fi que la PC con el
// backend corriendo (`node server.js`, puerto 3001) y el firewall de
// Windows permita esa conexión entrante. Para una app que no dependa de
// estar en la misma red, hace falta desplegar el backend en un servidor
// con URL pública y poner ESA acá.
//
// Si el celular no puede conectarse: correr `ipconfig` en la PC, buscar la
// IPv4 del adaptador real (Wi-Fi o Ethernet — no las "vEthernet" de Docker/
// WSL/VirtualBox), reemplazarla acá, y correr `npm run build:mobile` de
// nuevo (ver FASE_APP_MOVIL.md).
export const environment = {
  production: true,
  backendUrl: 'http://172.155.0.252:3001',
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
