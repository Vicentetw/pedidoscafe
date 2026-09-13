import { Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet, ActivatedRoute, Router, NavigationStart } from '@angular/router';
import { AuthService } from '../auth';
import { CurrentUserService } from '../current-user';
import { Api } from '../api';

interface NavItem {
  label: string;
  link: string;
  permission?: string;
  superadminOnly?: boolean;
}

// Shell de staff/admin: sidebar fija en desktop, barra superior + panel
// deslizable en mobile (el staff en el mostrador o cocina también usa el
// celular/tablet, no sólo el comensal). Mismo patrón en las dos superficies.
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="layout" [class.collapsed]="collapsed()">
      <header class="topbar">
        <button class="icon-btn" (click)="drawerOpen.set(true)" aria-label="Abrir menú">☰</button>
        <span class="brand">Restia Pedidos</span>
      </header>

      @if (drawerOpen()) {
        <div class="scrim" (click)="drawerOpen.set(false)"></div>
      }

      <aside class="side" [class.open]="drawerOpen()">
        <div class="side-head">
          <span class="brand">Restia Pedidos</span>
          <button class="icon-btn close-btn" (click)="drawerOpen.set(false)" aria-label="Cerrar menú">✕</button>
          <button class="icon-btn collapse-btn" (click)="collapsed.set(!collapsed())" aria-label="Contraer menú">☰</button>
        </div>
        @if (profile()?.isSuperadmin) {
          <a class="tenant-chip" routerLink="/admin/empresas" (click)="drawerOpen.set(false)">
            @if (selectedTenant(); as t) {
              <span class="muted small">Operando como</span>
              <strong>{{ t.name }}</strong>
            } @else {
              <span class="warn">⚠ Elegí una empresa</span>
            }
          </a>
        } @else if (profile()?.tenantName; as tn) {
          <div class="tenant-chip static">
            <span class="muted small">Empresa</span>
            <strong>{{ tn }}</strong>
          </div>
        }
        <nav>
          @for (item of visibleNav(); track item.link) {
            <a [routerLink]="item.link" routerLinkActive="active" (click)="drawerOpen.set(false)">{{ item.label }}</a>
          }
        </nav>
        <div class="user">
          <span class="muted email">{{ profile()?.email }}</span>
          <button (click)="signOut()">Salir</button>
        </div>
      </aside>

      <main><router-outlet /></main>
    </div>

    @if (newOrders(); as n) {
      <div class="modal-scrim" (click)="dismissNewOrders()">
        <div class="modal-card" (click)="$event.stopPropagation()">
          <p class="modal-icon">🔔</p>
          <h3>{{ n === 1 ? 'Hay un pedido nuevo' : n + ' pedidos nuevos' }}</h3>
          <p class="muted">Llegaron mientras no estabas mirando esta pantalla.</p>
          <div class="modal-actions">
            <button class="primary" (click)="goToOrders()">Ver pedidos</button>
            <button (click)="dismissNewOrders()">Cerrar</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .layout { display: grid; grid-template-columns: 240px 1fr; grid-template-rows: 1fr; min-height: 100dvh; }
      .layout.collapsed { grid-template-columns: 68px 1fr; }

      .topbar { display: none; }
      .scrim { display: none; }

      .side {
        background: var(--surface);
        border-right: 1px solid var(--border);
        padding: var(--space-3);
        display: flex;
        flex-direction: column;
        gap: 4px;
        overflow-y: auto;
      }
      .side-head { display: flex; align-items: center; gap: 8px; padding: 4px 6px 12px; }
      .brand { font-family: var(--font-display); font-weight: 700; font-size: 1.05rem; color: var(--primary); white-space: nowrap; overflow: hidden; }
      .close-btn { display: none; }
      .collapse-btn { margin-left: auto; }
      .icon-btn { border: none; background: transparent; font-size: 18px; padding: 8px; line-height: 1; border-radius: var(--radius-sm); }
      .icon-btn:hover { background: var(--surface-2); }

      .tenant-chip {
        display: flex; flex-direction: column; gap: 1px;
        padding: 8px 12px; margin-bottom: 8px;
        background: var(--surface-2); border-radius: var(--radius-sm);
        text-decoration: none; color: var(--text); font-size: 0.85rem;
      }
      .tenant-chip:hover { background: var(--primary-soft); }
      .tenant-chip.static:hover { background: var(--surface-2); }
      .tenant-chip strong { color: var(--primary-hover); }
      .tenant-chip .warn { color: var(--warning); font-weight: 600; }

      nav { display: flex; flex-direction: column; gap: 2px; flex: 1; }
      nav a {
        display: block;
        padding: 10px 12px;
        border-radius: var(--radius-sm);
        color: var(--text);
        text-decoration: none;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 0.92rem;
        transition: background-color 0.15s ease;
      }
      nav a:hover { background: var(--surface-2); }
      nav a.active { background: var(--primary-soft); color: var(--primary-hover); font-weight: 600; }

      .user { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--border); padding-top: 10px; margin-top: 6px; }
      .email { font-size: 0.78rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      main { padding: var(--space-5); min-width: 0; max-width: 1200px; width: 100%; margin: 0 auto; }

      .layout.collapsed .side-head .brand,
      .layout.collapsed nav a,
      .layout.collapsed .user,
      .layout.collapsed .tenant-chip { display: none; }
      .layout.collapsed .side-head { justify-content: center; }
      .layout.collapsed .collapse-btn { margin-left: 0; }

      @media (max-width: 880px) {
        .layout, .layout.collapsed { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }

        .topbar {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px var(--space-4);
          background: var(--surface);
          border-bottom: 1px solid var(--border);
          position: sticky;
          top: 0;
          z-index: 20;
          padding-top: calc(10px + env(safe-area-inset-top));
        }

        .scrim {
          display: block;
          position: fixed;
          inset: 0;
          background: rgba(20, 16, 12, 0.4);
          z-index: 29;
        }

        .side {
          position: fixed;
          inset: 0 25% 0 0;
          max-width: 320px;
          z-index: 30;
          transform: translateX(-100%);
          transition: transform 0.2s ease;
          box-shadow: var(--shadow-2);
          padding-top: calc(var(--space-3) + env(safe-area-inset-top));
          padding-bottom: calc(var(--space-3) + env(safe-area-inset-bottom));
        }
        .side.open { transform: translateX(0); }
        .side .close-btn { display: inline-flex; margin-left: auto; }
        .side .collapse-btn { display: none; }
        /* El colapso a sólo-íconos es un modo de escritorio; en mobile el
           panel siempre muestra las etiquetas completas. */
        .layout.collapsed .side-head .brand { display: block; }
        .layout.collapsed nav a { display: block; }
        .layout.collapsed .user { display: flex; }
        .layout.collapsed .tenant-chip { display: flex; }

        main { padding: var(--space-4); padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom)); }
      }

      .modal-scrim {
        position: fixed; inset: 0; background: rgba(20, 16, 12, 0.5);
        display: grid; place-items: center; z-index: 50; padding: var(--space-4);
      }
      .modal-card {
        background: var(--surface); border-radius: var(--radius); padding: var(--space-5);
        max-width: 340px; width: 100%; text-align: center; box-shadow: var(--shadow-2);
      }
      .modal-icon { font-size: 2.2rem; margin: 0 0 4px; }
      .modal-card h3 { margin: 0 0 6px; }
      .modal-actions { display: flex; gap: 8px; margin-top: var(--space-4); }
      .modal-actions button { flex: 1; }
    `,
  ],
})
export class Shell implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly currentUser = inject(CurrentUserService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(Api);

  readonly collapsed = signal(false);
  readonly drawerOpen = signal(false);
  readonly profile = this.currentUser.profile;
  readonly selectedTenant = this.currentUser.selectedTenant;

  // Aviso de "hay pedidos nuevos" — pedido en la aceptación: "una
  // notificación modal cuando hay pedidos y lo lleve a pedidos". Sin SSE
  // para staff todavía (exige Firebase, ver kitchen.service.js/staff-kds.ts
  // — el KDS mismo ya resuelve esto con polling corto), así que este aviso
  // GLOBAL (cualquier pantalla de staff/admin, no sólo Cocina) usa el
  // mismo patrón: sondea cada 20s cuántos pedidos están QUEUED en la
  // sucursal del usuario y, si el número SUBIÓ desde la última vuelta,
  // muestra el modal — nunca en la primera carga (sería un aviso falso de
  // "nuevo" por algo que ya estaba ahí de antes).
  readonly newOrders = signal<number | null>(null);
  private lastOrderCount: number | null = null;
  private orderPoll?: ReturnType<typeof setInterval>;

  private readonly surface = (this.route.snapshot.data['surface'] as 'staff' | 'admin') ?? 'admin';

  private readonly staffNav: NavItem[] = [
    { label: 'Mesas', link: '/staff/mesas', permission: 'tables:view' },
    { label: 'Mostrador', link: '/staff/mostrador', permission: 'orders:create' },
    { label: 'Cocina', link: '/staff/cocina', permission: 'kitchen:view' },
    // Sólo aparece si la empresa habilitó "el mozo puede cobrar"
    // (Configuración) — sin eso, el mozo no tiene payments:view.
    { label: 'Caja', link: '/staff/caja', permission: 'payments:view' },
  ];
  private readonly adminNav: NavItem[] = [
    { label: 'Inicio', link: '/admin/inicio' },
    { label: 'Menú', link: '/admin/menu', permission: 'catalog:view' },
    { label: 'Stock', link: '/admin/stock', permission: 'inventory:view' },
    { label: 'Mesas', link: '/admin/mesas', permission: 'tables:view' },
    { label: 'Caja', link: '/admin/caja', permission: 'payments:view' },
    { label: 'Cajas físicas', link: '/admin/cajas', permission: 'cash:view' },
    { label: 'Comprobantes', link: '/admin/fiscal', permission: 'settings:view' },
    { label: 'Clientes', link: '/admin/clientes', permission: 'crm:view' },
    { label: 'Promociones', link: '/admin/promociones', permission: 'promotions:view' },
    { label: 'Analítica', link: '/admin/analitica', permission: 'reports:view_sales' },
    { label: 'Dispositivos', link: '/admin/dispositivos', permission: 'devices:view' },
    { label: 'Sucursales', link: '/admin/sucursales', permission: 'branches:view' },
    { label: 'Usuarios y roles', link: '/admin/usuarios', permission: 'staff:view' },
    { label: 'Configuración', link: '/admin/configuracion', permission: 'settings:view' },
    { label: 'Empresas', link: '/admin/empresas', superadminOnly: true },
  ];

  readonly visibleNav = computed(() => {
    const items = this.surface === 'staff' ? this.staffNav : this.adminNav;
    const p = this.profile();
    return items.filter((i) => {
      if (i.superadminOnly) return p?.isSuperadmin === true;
      if (i.permission) return this.currentUser.hasPermission(i.permission);
      return true;
    });
  });

  constructor() {
    // Cerrar el panel mobile si el usuario navega por otro medio (atrás del navegador, etc.)
    this.router.events.subscribe((e) => { if (e instanceof NavigationStart) this.drawerOpen.set(false); });
    // Título de la pestaña: nombre de la empresa cuando hay una (la propia
    // del usuario, o la que eligió el superadmin), Restia Pedidos si no.
    effect(() => {
      const name = this.profile()?.tenantName || this.selectedTenant()?.name;
      document.title = name ? `${name} · Restia Pedidos` : 'Restia Pedidos';
    });
    // Arranca una sola vez, apenas se conoce la sucursal por defecto del
    // usuario (superadmin sin empresa elegida, o un owner sin sucursal
    // fija, simplemente no la tienen — se queda sin aviso, no rompe nada).
    effect(() => {
      const branchId = this.profile()?.defaultBranchId;
      if (branchId && !this.orderPoll && this.currentUser.hasPermission('orders:view')) {
        this.startOrderWatch(branchId);
      }
    });
  }

  ngOnDestroy() { clearInterval(this.orderPoll); }

  private startOrderWatch(branchId: number) {
    const check = () => {
      this.api.get<{ data: unknown[] }>(`/api/orders?branchId=${branchId}&status=QUEUED`).subscribe({
        next: (r) => {
          const count = r.data.length;
          if (this.lastOrderCount != null && count > this.lastOrderCount) this.newOrders.set(count);
          this.lastOrderCount = count;
        },
        error: () => { /* silencioso — esto es un aviso de cortesía, no algo crítico */ },
      });
    };
    check();
    this.orderPoll = setInterval(check, 20000);
  }

  dismissNewOrders() { this.newOrders.set(null); }
  goToOrders() {
    this.newOrders.set(null);
    this.router.navigateByUrl(this.surface === 'staff' ? '/staff/cocina' : '/admin/mesas');
  }

  signOut() {
    this.auth.signOut();
  }
}
