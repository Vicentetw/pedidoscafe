# pedidoscofee — instrucciones para agentes

Antes de cualquier cambio leé, en este orden:
1. `docs/AGENT_HANDOFF.md` (estado actual y próxima tarea)
2. `docs/KNOWN_ISSUES.md`
3. `docs/CRITICAL_FUNCTIONS.md`
4. Lo demás de `docs/` según lo que vayas a tocar.

Contrastá la documentación con el código y `git status`/`git log` antes de confiar en ella.

## Reglas
- `main` se despliega solo en Render (producción). No hacer commit/push a `main` sin pedido explícito.
- No tocar producción ni datos reales. No correr tests con el `.env` real: crean usuarios en Firebase `restiapedidos` (producción). Ver `docs/TESTING_STRATEGY.md`.
- Una falla por vez: reproducir con test que falle → causa raíz → propuesta → cambio mínimo → suite completa → informe. Esperar autorización entre fallas.
- Sin refactors no pedidos. Todo comportamiento existente es contrato.
- Al terminar: actualizar `docs/CHANGELOG.md`, `docs/KNOWN_ISSUES.md` y `docs/AGENT_HANDOFF.md`.
