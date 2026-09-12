import type { CapacitorConfig } from '@capacitor/cli';

// App nativa para mozos/empleados/dueños (staff + admin) — el comensal
// sigue entrando por QR en el navegador, sin instalar nada (a propósito,
// ver prompt.txt §23: "no requiere app" es una ventaja, no un olvido).
// webDir apunta al build "mobile" (ver angular.json), que usa
// environment.mobile.ts con una URL de backend absoluta — el APK no sirve
// nada por red propia, así que backendUrl no puede quedar relativo.
const config: CapacitorConfig = {
  appId: 'com.pedidoscofee.app', // identidad del paquete — no se toca al rebrandear el nombre visible
  appName: 'Restia Pedidos',
  webDir: 'dist/pedidoscofee/browser',
};

export default config;
