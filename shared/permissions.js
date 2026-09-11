// Catálogo canónico de permisos del sistema — un permiso es el string
// "modulo:accion" (mismo modelo que el sistema de asistencia). Esta es la
// ÚNICA fuente de verdad: la usa el seed de roles del backend
// (migrations/0002_seed_system_roles.sql se genera a partir de acá vía
// seeds/dev-seed.js para overrides, pero los roles de sistema se siembran
// en SQL) y la expone el backend al frontend en GET /api/platform/permissions
// para pintar la pantalla de Roles.
//
// Al agregar un permiso nuevo: sumarlo acá y a algún rol en
// 0002_seed_system_roles.sql. No hardcodear strings de permiso sueltos en
// las rutas — importar de acá.

/** @type {Record<string, { label: string, actions: Record<string, string> }>} */
const MODULES = {
  catalog: {
    label: 'Menú y productos',
    actions: {
      view: 'Ver menú, categorías y productos',
      manage: 'Crear y editar menú, categorías, productos, variantes y modificadores',
      update_price: 'Cambiar precios (global o por sucursal)',
    },
  },
  inventory: {
    label: 'Stock',
    actions: {
      view: 'Ver stock, movimientos y recetas',
      adjust: 'Ajustar stock manualmente y registrar mermas',
      purchase: 'Registrar compras a proveedores',
      manage_recipes: 'Definir recetas e ingredientes',
    },
  },
  tables: {
    label: 'Mesas',
    actions: {
      view: 'Ver mesas y sesiones',
      manage: 'Crear y editar mesas, generar y rotar sus códigos QR',
      open_session: 'Abrir sesión de mesa desde el salón',
      assign_waiter: 'Asignar mozos a mesas',
      force_close: 'Cerrar una mesa con saldo pendiente (con motivo)',
    },
  },
  orders: {
    label: 'Pedidos',
    actions: {
      view: 'Ver pedidos',
      create: 'Crear y cargar pedidos',
      amend: 'Modificar un pedido no pagado',
      cancel: 'Cancelar un pedido antes de preparación',
      cancel_after_prep: 'Cancelar un pedido ya en preparación',
      amend_paid: 'Modificar un pedido ya pagado (queda auditado)',
      set_priority: 'Cambiar la prioridad de un pedido',
    },
  },
  kitchen: {
    label: 'Cocina y barra',
    actions: {
      view: 'Ver el tablero de cocina (KDS)',
      advance_ticket: 'Avanzar el estado de un ticket de estación',
    },
  },
  payments: {
    label: 'Pagos',
    actions: {
      view: 'Ver pagos y conciliación',
      charge: 'Cobrar (generar y confirmar pagos)',
      refund: 'Hacer devoluciones',
      manage_mp_credentials: 'Configurar credenciales de MercadoPago',
    },
  },
  cash: {
    label: 'Caja',
    actions: {
      view: 'Ver cajas y arqueos',
      manage: 'Crear y editar cajas físicas',
      open: 'Abrir caja',
      close: 'Cerrar caja y arquear',
      movement: 'Registrar ingresos y retiros de caja',
    },
  },
  reports: {
    label: 'Reportes',
    actions: {
      view_sales: 'Ver reportes de ventas',
      view_profit: 'Ver márgenes y rentabilidad',
      view_audit: 'Ver el registro de auditoría',
    },
  },
  crm: {
    label: 'Clientes (CRM)',
    actions: {
      view: 'Ver clientes',
      manage: 'Editar clientes y segmentos',
    },
  },
  loyalty: {
    label: 'Fidelización',
    actions: {
      view: 'Ver cuentas y movimientos de puntos',
      adjust: 'Ajustar puntos manualmente (queda auditado)',
    },
  },
  promotions: {
    label: 'Promociones',
    actions: {
      view: 'Ver promociones',
      manage: 'Crear y editar promociones y sus reglas',
    },
  },
  staff: {
    label: 'Personal',
    actions: {
      view: 'Ver el personal de la sucursal',
      manage: 'Alta/baja y edición de personal, usuarios y roles de la empresa',
    },
  },
  devices: {
    label: 'Dispositivos (buzzers, impresoras, pantallas)',
    actions: {
      view: 'Ver dispositivos y su estado',
      manage: 'Registrar y editar dispositivos',
      assign: 'Asignar y liberar un dispositivo en un pedido',
    },
  },
  branches: {
    label: 'Sucursales',
    actions: {
      view: 'Ver sucursales',
      manage: 'Crear y editar sucursales',
    },
  },
  settings: {
    label: 'Configuración',
    actions: {
      view: 'Ver la configuración del negocio',
      manage: 'Cambiar la configuración del negocio',
    },
  },
  platform: {
    label: 'Plataforma (operador del SaaS)',
    actions: {
      manage_tenants: 'Crear y administrar empresas',
      manage_plans: 'Administrar planes de suscripción',
      impersonate: 'Operar en nombre de una empresa',
    },
  },
};

/** Lista plana ["catalog:view", "catalog:manage", ...] con TODOS los permisos. */
const ALL_PERMISSIONS = Object.entries(MODULES).flatMap(([mod, def]) =>
  Object.keys(def.actions).map((action) => `${mod}:${action}`)
);

/** true si `perm` tiene la forma "modulo:accion" y existe en el catálogo. */
function isValidPermission(perm) {
  return ALL_PERMISSIONS.includes(perm);
}

module.exports = { MODULES, ALL_PERMISSIONS, isValidPermission };
