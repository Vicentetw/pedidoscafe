import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { AuthService } from '../../core/auth';
import { environment } from '../../../environments/environment';

interface Branch { id: number; name: string; }
interface Station { id: number; name: string; type: string; }
interface Ticket {
  id: number; order_id: number; order_public_id: string; station_id: number | null; station_name: string | null;
  status: string; sequence_no: number; priority: string; channel: string;
  items: { name: string; variant: string | null; qty: number; note: string | null; status: string }[];
}

@Component({
  selector: 'app-staff-kds',
  imports: [FormsModule],
  template: `
    <h1>Cocina</h1>
    @if (error()) { <p style="color:var(--danger)">{{ error() }}</p> }

    <div class="bar">
      <select [ngModel]="branchId()" (ngModelChange)="pickBranch($event)">
        @for (b of branches(); track b.id) { <option [ngValue]="b.id">{{ b.name }}</option> }
      </select>
      <select [ngModel]="stationId()" (ngModelChange)="pickStation($event)">
        <option [ngValue]="null">Todas las estaciones</option>
        @for (s of stations(); track s.id) { <option [ngValue]="s.id">{{ s.name }}</option> }
      </select>
      <button (click)="load()">Actualizar</button>
    </div>

    <div class="board">
      @for (t of tickets(); track t.id) {
        <div class="ticket p-{{ t.priority }}">
          <div class="th">
            <strong>#{{ t.sequence_no }}</strong>
            <span>{{ t.station_name || 'General' }}</span>
            <span class="badge badge-danger" [hidden]="t.priority === 'NORMAL'">{{ t.priority }}</span>
          </div>
          <ul>
            @for (it of t.items; track $index) {
              <li>{{ it.qty }}× {{ it.name }}{{ it.variant ? ' (' + it.variant + ')' : '' }}
                @if (it.note) { <em> — {{ it.note }}</em> }
              </li>
            }
          </ul>
          <div class="tf">
            <span class="badge">{{ t.status }}</span>
            @if (t.status !== 'DELIVERED') {
              <button class="primary" (click)="advance(t)">{{ nextLabel(t.status) }}</button>
            }
          </div>
        </div>
      } @empty { <p class="muted">No hay tickets pendientes.</p> }
    </div>
  `,
  styles: [`
    .bar { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
    .bar select { width: auto; }
    .board { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
    .ticket { border: 1px solid var(--border); border-radius: 12px; padding: 10px; background: var(--surface); }
    .ticket.p-URGENT, .ticket.p-LATE { border-color: var(--danger); }
    .th { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: .9rem; }
    ul { margin: 8px 0; padding-left: 16px; }
    .tf { display: flex; justify-content: space-between; align-items: center; }
  `],
})
export class StaffKds implements OnInit, OnDestroy {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthService);

  readonly branches = signal<Branch[]>([]);
  readonly stations = signal<Station[]>([]);
  readonly branchId = signal<number | null>(null);
  readonly stationId = signal<number | null>(null);
  readonly tickets = signal<Ticket[]>([]);
  readonly error = signal('');
  private es?: EventSource;

  ngOnInit() {
    this.api.get<{ data: Branch[] }>('/api/platform/branches').subscribe({
      next: (r) => { this.branches.set(r.data); if (r.data[0]) this.pickBranch(r.data[0].id); },
      error: (e) => this.error.set(e?.error?.error ?? 'No se pudieron cargar las sucursales.'),
    });
  }
  ngOnDestroy() { this.es?.close(); }

  pickBranch(id: number) {
    this.branchId.set(id);
    this.stationId.set(null);
    this.api.get<{ data: Station[] }>(`/api/kitchen/stations?branchId=${id}`).subscribe({ next: (r) => this.stations.set(r.data), error: () => this.stations.set([]) });
    this.load();
    this.subscribe();
  }
  pickStation(id: number | null) { this.stationId.set(id); this.load(); }

  load() {
    if (!this.branchId()) return;
    let url = `/api/kitchen/tickets?branchId=${this.branchId()}`;
    if (this.stationId()) url += `&stationId=${this.stationId()}`;
    this.api.get<{ data: Ticket[] }>(url).subscribe({
      next: (r) => this.tickets.set(r.data),
      error: (e) => this.error.set(e?.error?.error ?? 'No se pudo cargar el tablero.'),
    });
  }

  nextLabel(s: string) { return { QUEUED: 'Empezar', PREPARING: 'Marcar listo', READY: 'Entregar' }[s] ?? 'Avanzar'; }

  advance(t: Ticket) {
    this.api.post(`/api/kitchen/tickets/${t.id}/advance`, {}).subscribe({ next: () => this.load(), error: (e) => this.error.set(e?.error?.error ?? 'No se pudo avanzar.') });
  }

  private async subscribe() {
    this.es?.close();
    const token = await this.auth.getIdToken();
    if (!token) return;
    // El stream de staff exige Firebase; EventSource no manda headers, así
    // que por ahora se refresca por polling corto.
    this.es = undefined;
    clearInterval((this as any)._poll);
    (this as any)._poll = setInterval(() => this.load(), 8000);
  }
}
