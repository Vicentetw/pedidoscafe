# shared/

Contratos que comparten backend y frontend. JS plano / JSON, sin build.

- **`permissions.js`** — catálogo canónico de permisos `"modulo:accion"`. Fuente de
  verdad para el seed de roles del backend y para la pantalla de Roles del frontend.

El backend lo `require('../../shared/permissions')`. El frontend lo consume vía la API
(`GET /api/platform/permissions`), no por import directo, para no acoplar el build de
Angular a archivos fuera de `frontend/`.

A medida que avancen las fases se agregan acá las definiciones de máquinas de estado
(`Order`, `Payment`, `TableSession`) y los nombres de eventos de dominio.
