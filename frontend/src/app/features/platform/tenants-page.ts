import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api } from '../../core/api';
import { CurrentUserService } from '../../core/current-user';

interface Tenant {
  id: number;
  name: string;
  slug: string;
  status: string;
  branch_count: number;
  user_count: number;
}

// Sólo el operador de la plataforma. Acá elige con qué empresa operar —
// ver auth-interceptor.ts: una vez elegida, todas las páginas de negocio
// (menú, stock, caja, etc.) le suman automáticamente ?tenantId= a cada
// pedido. Sin elegir una, esas páginas van a fallar con "indicá la empresa".
@Component({
  selector: 'app-tenants-page',
  imports: [FormsModule],
  template: `
    <h1>Empresas</h1>
    <p class="muted">Sólo el operador de la plataforma. Elegí una empresa para poder ver/editar sus datos en el resto del panel.</p>

    @if (selected(); as t) {
      <div class="card current">
        <p class="muted small">Operando como</p>
        <p class="current-name">{{ t.name }}</p>
        <button (click)="clear()">Dejar de operar como esta empresa</button>
      </div>
    }

    @if (loading()) {
      <p class="muted">Cargando…</p>
    } @else {
      <div class="card">
        <table>
          <thead><tr><th>Nombre</th><th>Slug</th><th>Estado</th><th>Sucursales</th><th>Usuarios</th><th></th></tr></thead>
          <tbody>
            @for (t of tenants(); track t.id) {
              <tr [class.active-row]="selected()?.id === t.id">
                <td>{{ t.name }}</td><td>{{ t.slug }}</td><td>{{ t.status }}</td><td>{{ t.branch_count }}</td><td>{{ t.user_count }}</td>
                <td>
                  @if (selected()?.id === t.id) {
                    <span class="badge badge-primary">activa</span>
                  } @else {
                    <button class="link" (click)="operate(t)">Operar como esta</button>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="muted">Sin empresas.</td></tr>
            }
          </tbody>
        </table>
      </div>

      <div class="card new-form">
        <div class="field"><label>Nombre de la empresa</label><input [(ngModel)]="newName" /></div>
        <button class="primary" [disabled]="saving()" (click)="create()">Crear empresa</button>
      </div>
    }
    @if (error()) { <p class="err">{{ error() }}</p> }
  `,
  styles: [`
    .current { background: var(--primary-soft); border-color: transparent; margin-bottom: var(--space-4); }
    .current .small { margin: 0; }
    .current-name { font-family: var(--font-display); font-size: 1.2rem; font-weight: 600; color: var(--primary-hover); margin: 2px 0 var(--space-3); }
    .active-row { background: var(--primary-soft); }
    .new-form { margin-top: var(--space-4); display: flex; gap: var(--space-3); align-items: flex-end; flex-wrap: wrap; }
    .field { flex: 1; min-width: 200px; }
    .field label { margin-top: 0; }
    .err { color: var(--danger); }
  `],
})
export class TenantsPage implements OnInit {
  private readonly api = inject(Api);
  private readonly currentUser = inject(CurrentUserService);
  private readonly router = inject(Router);

  readonly tenants = signal<Tenant[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly selected = this.currentUser.selectedTenant;
  newName = '';

  ngOnInit() {
    this.load();
  }

  private load() {
    this.loading.set(true);
    this.api.get<{ data: Tenant[] }>('/api/platform/tenants').subscribe({
      next: (r) => {
        this.tenants.set(r.data);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(e?.error?.error ?? 'No se pudieron cargar las empresas.');
        this.loading.set(false);
      },
    });
  }

  operate(t: Tenant) {
    this.currentUser.setSelectedTenant({ id: t.id, name: t.name });
    this.router.navigateByUrl('/admin/inicio');
  }
  clear() {
    this.currentUser.setSelectedTenant(null);
  }

  create() {
    this.error.set('');
    this.saving.set(true);
    this.api.post<Tenant>('/api/platform/tenants', { name: this.newName.trim() }).subscribe({
      next: () => {
        this.newName = '';
        this.saving.set(false);
        this.load();
      },
      error: (e) => {
        this.error.set(e?.error?.error ?? 'No se pudo crear la empresa.');
        this.saving.set(false);
      },
    });
  }
}
