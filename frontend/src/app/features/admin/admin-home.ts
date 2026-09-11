import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CurrentUserService } from '../../core/current-user';

@Component({
  selector: 'app-admin-home',
  imports: [RouterLink],
  template: `
    <h1>Inicio</h1>
    <div class="card">
      <p>Hola, <strong>{{ profile()?.displayName || profile()?.email }}</strong>.</p>

      @if (profile()?.isSuperadmin) {
        <p class="muted">Operás como superadmin de la plataforma.</p>
        @if (selectedTenant(); as t) {
          <p class="muted">Empresa activa: <strong>{{ t.name }}</strong>. <a class="link" routerLink="/admin/empresas">Cambiar</a></p>
        } @else {
          <p class="warn">Todavía no elegiste una empresa — <a class="link" routerLink="/admin/empresas">elegí una acá</a> para poder ver o editar sus datos.</p>
        }
      } @else {
        <p class="muted">{{ profile()?.permissions?.length }} permisos habilitados en tu cuenta.</p>
      }
    </div>

    <div class="quick">
      <a class="qcard" routerLink="/admin/mesas"><span>🪑</span>Mesas</a>
      <a class="qcard" routerLink="/admin/caja"><span>💳</span>Caja</a>
      <a class="qcard" routerLink="/admin/analitica"><span>📊</span>Analítica</a>
      <a class="qcard" routerLink="/admin/clientes"><span>👥</span>Clientes</a>
    </div>
  `,
  styles: [`
    .warn { color: var(--warning); }
    .quick { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: var(--space-3); margin-top: var(--space-4); }
    .qcard {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: var(--space-4) var(--space-2); background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius); text-decoration: none; color: var(--text); font-weight: 600; font-size: .88rem;
      box-shadow: var(--shadow-1); transition: transform .1s ease, box-shadow .15s ease;
    }
    .qcard:hover { box-shadow: var(--shadow-2); transform: translateY(-1px); }
    .qcard span { font-size: 1.6rem; }
  `],
})
export class AdminHome {
  private readonly currentUser = inject(CurrentUserService);
  readonly profile = this.currentUser.profile;
  readonly selectedTenant = this.currentUser.selectedTenant;
}
