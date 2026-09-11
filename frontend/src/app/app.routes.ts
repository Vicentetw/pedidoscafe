import { Routes } from '@angular/router';
import { sessionGuard } from './core/session-guard';
import { permissionGuard } from './core/permission-guard';

// Tres superficies (ARQUITECTURA_V1 §16):
//   /t/:token  -> comensal, sin login (Fase 3)
//   /staff     -> mozo / cocina / caja
//   /admin     -> back-office (dueño / admin) + plataforma
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'admin' },

  {
    path: 'login',
    loadComponent: () => import('./core/login/login').then((m) => m.Login),
  },
  {
    path: 'acceso-denegado',
    loadComponent: () => import('./core/access-denied/access-denied').then((m) => m.AccessDenied),
  },

  // Superficie comensal — pública.
  {
    path: 't/:token', // desde la mesa (QR): resolver + unirse a la sesión
    loadComponent: () => import('./features/client/table-session').then((m) => m.TableSession),
  },
  {
    path: 'm/:tenantSlug/:branchCode', // menú de vidriera (Fase 2)
    loadComponent: () => import('./features/client/menu-public-page').then((m) => m.MenuPublicPage),
  },
  {
    path: 'pedido/:publicId', // seguimiento de mostrador sin login (Fase 13)
    loadComponent: () => import('./features/client/order-tracking').then((m) => m.OrderTracking),
  },

  // Superficie staff.
  {
    path: 'staff',
    canActivate: [sessionGuard],
    loadComponent: () => import('./core/shell/shell').then((m) => m.Shell),
    data: { surface: 'staff' },
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'mesas' },
      {
        path: 'mesas',
        canActivate: [permissionGuard],
        data: { permission: 'tables:view' },
        loadComponent: () => import('./features/staff/staff-tables').then((m) => m.StaffTables),
      },
      {
        path: 'mostrador',
        canActivate: [permissionGuard],
        data: { permission: 'orders:create' },
        loadComponent: () => import('./features/staff/order-entry').then((m) => m.OrderEntry),
      },
      {
        path: 'cocina',
        canActivate: [permissionGuard],
        data: { permission: 'kitchen:view' },
        loadComponent: () => import('./features/staff/staff-kds').then((m) => m.StaffKds),
      },
    ],
  },

  // Superficie back-office / plataforma.
  {
    path: 'admin',
    canActivate: [sessionGuard],
    loadComponent: () => import('./core/shell/shell').then((m) => m.Shell),
    data: { surface: 'admin' },
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'inicio' },
      {
        path: 'inicio',
        loadComponent: () => import('./features/admin/admin-home').then((m) => m.AdminHome),
      },
      {
        path: 'sucursales',
        canActivate: [permissionGuard],
        data: { permission: 'branches:view' },
        loadComponent: () => import('./features/admin/branches-page').then((m) => m.BranchesPage),
      },
      {
        path: 'menu',
        canActivate: [permissionGuard],
        data: { permission: 'catalog:view' },
        loadComponent: () => import('./features/admin/catalog-page').then((m) => m.CatalogPage),
      },
      {
        path: 'mesas',
        canActivate: [permissionGuard],
        data: { permission: 'tables:view' },
        loadComponent: () => import('./features/admin/tables-page').then((m) => m.TablesPage),
      },
      {
        path: 'stock',
        canActivate: [permissionGuard],
        data: { permission: 'inventory:view' },
        loadComponent: () => import('./features/admin/stock-page').then((m) => m.StockPage),
      },
      {
        path: 'caja',
        canActivate: [permissionGuard],
        data: { permission: 'payments:view' },
        loadComponent: () => import('./features/admin/payments-page').then((m) => m.PaymentsPage),
      },
      {
        path: 'cajas',
        canActivate: [permissionGuard],
        data: { permission: 'cash:view' },
        loadComponent: () => import('./features/admin/cash-page').then((m) => m.CashPage),
      },
      {
        path: 'fiscal',
        canActivate: [permissionGuard],
        data: { permission: 'settings:view' },
        loadComponent: () => import('./features/admin/fiscal-page').then((m) => m.FiscalPage),
      },
      {
        path: 'clientes',
        canActivate: [permissionGuard],
        data: { permission: 'crm:view' },
        loadComponent: () => import('./features/admin/crm-page').then((m) => m.CrmPage),
      },
      {
        path: 'promociones',
        canActivate: [permissionGuard],
        data: { permission: 'promotions:view' },
        loadComponent: () => import('./features/admin/promotions-page').then((m) => m.PromotionsPage),
      },
      {
        path: 'analitica',
        canActivate: [permissionGuard],
        data: { permission: 'reports:view_sales' },
        loadComponent: () => import('./features/admin/analytics-page').then((m) => m.AnalyticsPage),
      },
      {
        path: 'dispositivos',
        canActivate: [permissionGuard],
        data: { permission: 'devices:view' },
        loadComponent: () => import('./features/admin/devices-page').then((m) => m.DevicesPage),
      },
      {
        path: 'usuarios',
        canActivate: [permissionGuard],
        data: { permission: 'staff:view' },
        loadComponent: () => import('./features/admin/users-page').then((m) => m.UsersPage),
      },
      {
        path: 'empresas',
        canActivate: [permissionGuard],
        data: { superadminOnly: true },
        loadComponent: () => import('./features/platform/tenants-page').then((m) => m.TenantsPage),
      },
      {
        path: 'configuracion',
        canActivate: [permissionGuard],
        data: { permission: 'settings:view' },
        loadComponent: () => import('./features/admin/settings-page').then((m) => m.SettingsPage),
      },
    ],
  },

  { path: '**', redirectTo: 'admin' },
];
