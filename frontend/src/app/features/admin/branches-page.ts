import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { CurrentUserService } from '../../core/current-user';

interface Branch {
  id: number;
  code: string;
  name: string;
  timezone: string;
  status: string;
}

@Component({
  selector: 'app-branches-page',
  imports: [FormsModule],
  template: `
    <h1>Sucursales</h1>

    @if (loading()) {
      <p class="muted">Cargando…</p>
    } @else {
      <table class="card" style="width:100%; border-collapse: collapse;">
        <thead>
          <tr><th>Código</th><th>Nombre</th><th>Zona horaria</th><th>Estado</th></tr>
        </thead>
        <tbody>
          @for (b of branches(); track b.id) {
            <tr><td>{{ b.code }}</td><td>{{ b.name }}</td><td>{{ b.timezone }}</td><td>{{ b.status }}</td></tr>
          } @empty {
            <tr><td colspan="4" class="muted">Todavía no hay sucursales.</td></tr>
          }
        </tbody>
      </table>
    }

    @if (canManage()) {
      <div class="card" style="margin-top:16px; display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end;">
        <div><label>Código</label><input [(ngModel)]="newCode" /></div>
        <div style="flex:1; min-width:180px;"><label>Nombre</label><input [(ngModel)]="newName" /></div>
        <button class="primary" [disabled]="saving()" (click)="create()">Agregar</button>
      </div>
    }
    @if (error()) { <p style="color:var(--danger)">{{ error() }}</p> }
  `,
})
export class BranchesPage implements OnInit {
  private readonly api = inject(Api);
  private readonly currentUser = inject(CurrentUserService);

  readonly branches = signal<Branch[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');

  newCode = '';
  newName = '';

  canManage() {
    return this.currentUser.hasPermission('branches:manage');
  }

  ngOnInit() {
    this.load();
  }

  private load() {
    this.loading.set(true);
    this.api.get<{ data: Branch[] }>('/api/platform/branches').subscribe({
      next: (r) => {
        this.branches.set(r.data);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(e?.error?.error ?? 'No se pudieron cargar las sucursales.');
        this.loading.set(false);
      },
    });
  }

  create() {
    this.error.set('');
    this.saving.set(true);
    this.api.post<Branch>('/api/platform/branches', { code: this.newCode.trim(), name: this.newName.trim() }).subscribe({
      next: () => {
        this.newCode = '';
        this.newName = '';
        this.saving.set(false);
        this.load();
      },
      error: (e) => {
        this.error.set(e?.error?.error ?? 'No se pudo crear la sucursal.');
        this.saving.set(false);
      },
    });
  }
}
