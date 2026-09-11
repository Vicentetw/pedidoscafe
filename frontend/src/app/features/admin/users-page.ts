import { Component, OnInit, inject, signal } from '@angular/core';
import { Api } from '../../core/api';

interface UserRow {
  id: number;
  email: string;
  display_name: string | null;
  status: string;
  roles: { code: string; name: string; branchId: number | null }[];
}

@Component({
  selector: 'app-users-page',
  template: `
    <h1>Usuarios y roles</h1>
    @if (loading()) {
      <p class="muted">Cargando…</p>
    } @else {
      <table class="card" style="width:100%; border-collapse:collapse;">
        <thead><tr><th>Email</th><th>Nombre</th><th>Roles</th><th>Estado</th></tr></thead>
        <tbody>
          @for (u of users(); track u.id) {
            <tr>
              <td>{{ u.email }}</td>
              <td>{{ u.display_name || '—' }}</td>
              <td>{{ u.roles.length ? rolesLabel(u) : '—' }}</td>
              <td>{{ u.status }}</td>
            </tr>
          } @empty {
            <tr><td colspan="4" class="muted">Sin usuarios.</td></tr>
          }
        </tbody>
      </table>
      <p class="muted" style="margin-top:12px">
        Invitar usuarios y asignar roles requiere Firebase Admin configurado en el backend.
        La pantalla completa (formulario de invitación + editor de roles) llega junto con el resto del back-office.
      </p>
    }
    @if (error()) { <p style="color:var(--danger)">{{ error() }}</p> }
  `,
})
export class UsersPage implements OnInit {
  private readonly api = inject(Api);
  readonly users = signal<UserRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');

  rolesLabel(u: UserRow) {
    return u.roles.map((r) => r.name).join(', ');
  }

  ngOnInit() {
    this.api.get<{ data: UserRow[] }>('/api/platform/users').subscribe({
      next: (r) => {
        this.users.set(r.data);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(e?.error?.error ?? 'No se pudieron cargar los usuarios.');
        this.loading.set(false);
      },
    });
  }
}
