import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { CurrentUserService } from '../../core/current-user';
import { SessionOrderDetail } from '../shared/session-order-detail';

interface Branch { id: number; name: string; }
interface OpenSession {
  id: number; public_id: string; table_code: string; status: string;
  order_mode: string; participant_count: number; opened_at: string;
}

const STATUS_LABEL: Record<string, string> = { OPEN: 'Abierta', ORDERING: 'Pidiendo', SERVING: 'Sirviendo', BILL_REQUESTED: 'Pide la cuenta', PARTIALLY_PAID: 'Pago parcial', PAID: 'Saldada' };

// Salón: mesas abiertas + qué pidió cada uno. Antes esta pantalla era un
// placeholder literal de la Fase 3 ("se implementa en la Fase 3") — el
// mozo no tenía ninguna forma real de ver el salón ni lo que se pidió en
// cada mesa (bug real encontrado en la aceptación).
@Component({
  selector: 'app-staff-tables',
  imports: [FormsModule, SessionOrderDetail],
  template: `
    <h1>Mesas</h1>
    @if (error()) { <p class="err">{{ error() }}</p> }

    <div class="card">
      <label>Sucursal</label>
      <select [ngModel]="branchId()" (ngModelChange)="pickBranch($event)">
        @for (b of branches(); track b.id) { <option [ngValue]="b.id">{{ b.name }}</option> }
      </select>
    </div>

    <div class="card">
      <h3>Mesas abiertas</h3>
      <ul class="sessions">
        @for (s of sessions(); track s.id) {
          <li>
            <button class="srow" [class.sel]="selected()?.id === s.id" (click)="select(s)">
              <span><strong>Mesa {{ s.table_code }}</strong> · {{ statusLabel(s.status) }} · {{ s.participant_count }} persona(s)
                @if (isStale(s)) { <span class="badge badge-warning">⏱ hace {{ openMinutes(s) }} min</span> }
              </span>
              <span class="chev">{{ selected()?.id === s.id ? '▲' : '▼' }}</span>
            </button>
            @if (selected()?.id === s.id) {
              <div class="detail">
                <app-session-order-detail [sessionId]="s.id" (changed)="loadSessions()" />
                <div class="row">
                  <button (click)="close(s)">Cerrar mesa</button>
                  @if (canForceClose()) { <button class="danger" (click)="forceClose(s)">Cierre forzado</button> }
                </div>
              </div>
            }
          </li>
        } @empty { <li class="muted">Ninguna mesa abierta.</li> }
      </ul>
    </div>
  `,
  styles: [`
    .card { margin-bottom: var(--space-4); }
    .err { color: var(--danger); }
    .sessions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .srow {
      width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 8px;
      padding: 10px 12px; border-radius: var(--radius-sm); background: var(--surface-2); border: 1px solid transparent;
      text-align: left; font-size: .92rem;
    }
    .srow.sel { border-color: var(--primary); }
    .chev { color: var(--muted); font-size: .75rem; }
    .detail { padding: var(--space-3) 8px 4px; }
    .row { display: flex; gap: 8px; margin-top: var(--space-2); }
  `],
})
export class StaffTables implements OnInit, OnDestroy {
  private readonly api = inject(Api);
  private readonly currentUser = inject(CurrentUserService);

  readonly branches = signal<Branch[]>([]);
  readonly branchId = signal<number | null>(null);
  readonly sessions = signal<OpenSession[]>([]);
  readonly selected = signal<OpenSession | null>(null);
  readonly error = signal('');

  canForceClose() { return this.currentUser.hasPermission('tables:force_close'); }
  statusLabel(s: string) { return STATUS_LABEL[s] ?? s; }
  private staleMinutes = 120;
  isStale(s: OpenSession) { return this.openMinutes(s) >= this.staleMinutes; }
  openMinutes(s: OpenSession) { return Math.floor((Date.now() - new Date(s.opened_at).getTime()) / 60000); }

  private poll?: ReturnType<typeof setInterval>;

  ngOnInit() {
    this.api.get<{ data: Branch[] }>('/api/platform/branches').subscribe({
      next: (r) => { this.branches.set(r.data); if (r.data[0]) this.pickBranch(r.data[0].id); },
      error: (e) => this.fail(e, 'No se pudieron cargar las sucursales.'),
    });
    this.poll = setInterval(() => { if (this.branchId() && this.selected() == null) this.loadSessions(); }, 8000);
  }
  ngOnDestroy() { clearInterval(this.poll); }
  private fail(e: any, m: string) { this.error.set(e?.error?.error ?? m); }

  pickBranch(id: number) {
    this.branchId.set(id);
    this.selected.set(null);
    this.loadSessions();
    this.api.get<{ data: Record<string, unknown> }>(`/api/platform/settings?branchId=${id}`).subscribe({
      next: (r) => { const v = r.data['orders.abandon_timeout_minutes']; this.staleMinutes = typeof v === 'number' ? v : 120; },
      error: () => { this.staleMinutes = 120; }, // el mozo puede no tener settings:view — degrada a default, no rompe
    });
  }

  loadSessions() {
    if (!this.branchId()) return;
    this.api.get<{ data: OpenSession[] }>(`/api/tables/sessions/open?branchId=${this.branchId()}`).subscribe({
      next: (r) => this.sessions.set(r.data),
      error: (e) => this.fail(e, 'No se pudieron cargar las mesas.'),
    });
  }

  select(s: OpenSession) {
    this.selected.set(this.selected()?.id === s.id ? null : s);
  }

  close(s: OpenSession) {
    this.api.post(`/api/tables/sessions/${s.id}/close`, {}).subscribe({
      next: () => { this.loadSessions(); this.selected.set(null); },
      error: (e) => {
        const msg = e?.error?.error ?? 'No se pudo cerrar (¿saldo pendiente?).';
        this.fail(e, msg);
        alert(msg); // este aviso no se puede pasar por alto — se ve como modal
      },
    });
  }
  forceClose(s: OpenSession) {
    const reason = prompt('Motivo del cierre forzado:');
    if (reason == null) return;
    this.api.post(`/api/tables/sessions/${s.id}/force-close`, { reason }).subscribe({
      next: () => { this.loadSessions(); this.selected.set(null); },
      error: (e) => this.fail(e, 'No se pudo forzar el cierre.'),
    });
  }
}
