import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';

interface Branch { id: number; name: string; }
interface OpenSession { id: number; public_id: string; table_code: string; status: string; participant_count: number; }
interface Balance {
  status: string; currency: string; total: string; paid: string; remaining: string;
  byParticipant: { participantId: string; name: string; owed: string; paid: string; remaining: string }[];
}
interface Payment { id: number; public_id: string; kind: string; provider: string; amount: string; status: string; created_at: string; }

// Caja — cobrar mesas abiertas, dividir la cuenta, ver pagos y hacer
// devoluciones. /admin/caja, permiso payments:charge para cobrar.
@Component({
  selector: 'app-payments-page',
  imports: [FormsModule],
  template: `
    <h1>Caja</h1>
    @if (error()) { <p style="color:var(--danger)">{{ error() }}</p> }

    <div class="card">
      <label>Sucursal</label>
      <select [ngModel]="branchId()" (ngModelChange)="pickBranch($event)">
        @for (b of branches(); track b.id) { <option [ngValue]="b.id">{{ b.name }}</option> }
      </select>
    </div>

    @if (reconciliation(); as rec) {
      <div class="card">
        <h3>Conciliación</h3>
        <p class="muted small">A partir del propio registro del sistema (sin cuenta real de MercadoPago conectada todavía).</p>
        <ul>
          <li>Pagos pendientes hace rato: {{ rec.stalePending.length }}</li>
          <li>Pedidos de mostrador entregados sin cobrar: {{ rec.unpaidCounterOrders.length }}</li>
          <li>Mesas cerradas por la fuerza con saldo: {{ rec.forceClosedWithBalance.length }}</li>
          <li>Devoluciones pendientes: {{ rec.pendingRefunds.length }}</li>
        </ul>
      </div>
    }

    <div class="cols">
      <div class="card">
        <h3>Mesas abiertas</h3>
        <ul>
          @for (s of sessions(); track s.id) {
            <li>
              <button class="link" [class.sel]="s.id === selected()?.id" (click)="select(s)">
                Mesa {{ s.table_code }} — {{ s.status }} ({{ s.participant_count }})
              </button>
            </li>
          } @empty { <li class="muted">Ninguna mesa abierta.</li> }
        </ul>
      </div>

      @if (selected() && balance(); as bal) {
        <div class="card">
          <h3>Mesa {{ selected()!.table_code }}</h3>
          <p>Total: {{ bal.currency }} {{ bal.total }} · Pagado: {{ bal.currency }} {{ bal.paid }} · <strong>Falta: {{ bal.currency }} {{ bal.remaining }}</strong></p>

          @if (+bal.remaining > 0) {
            <div class="row">
              <button class="primary" [disabled]="busy()" (click)="chargeGroup()">Cobrar todo (efectivo)</button>
              <input type="number" placeholder="partes" [(ngModel)]="parts" style="max-width:90px" />
              <button [disabled]="busy()" (click)="splitEqual()">Dividir en partes iguales</button>
            </div>
            <h4>Por persona</h4>
            <ul>
              @for (p of bal.byParticipant; track p.participantId) {
                <li>
                  {{ p.name }}: debe {{ bal.currency }} {{ p.remaining }}
                  @if (+p.remaining > 0) { <button (click)="chargeIndividual(p.participantId)">Cobrar (efectivo)</button> }
                </li>
              }
            </ul>
          } @else {
            <p class="muted">Saldada.</p>
          }

          <h4>Pagos</h4>
          <table style="width:100%; border-collapse:collapse;">
            <thead><tr><th>Cuándo</th><th>Modo</th><th>Medio</th><th>Monto</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              @for (p of payments(); track p.id) {
                <tr>
                  <td>{{ p.created_at }}</td><td>{{ p.kind }}</td><td>{{ p.provider }}</td><td>{{ p.amount }}</td><td>{{ p.status }}</td>
                  <td>
                    @if (p.status === 'APPROVED' || p.status === 'SETTLED') { <button (click)="refund(p)">Devolver</button> }
                    @if (p.provider === 'MERCADOPAGO' && p.status === 'PENDING') {
                      <button [disabled]="checking() === p.id" (click)="checkMpStatus(p)">{{ checking() === p.id ? 'Verificando…' : 'Verificar pago' }}</button>
                    }
                  </td>
                </tr>
              } @empty { <tr><td colspan="6" class="muted">Sin pagos todavía.</td></tr> }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
  styles: [`
    .cols { display:grid; grid-template-columns: 260px 1fr; gap:16px; }
    @media (max-width: 720px) { .cols { grid-template-columns: 1fr; } }
    ul { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:4px; }
    button.link { border:none; background:none; text-align:left; padding:6px; color:var(--text); width:100%; border-radius:8px; }
    button.link.sel, button.link:hover { background: var(--border); }
    .row { display:flex; gap:8px; flex-wrap:wrap; margin: 10px 0; align-items:center; }
    h4 { margin: 14px 0 4px; }
  `],
})
export class PaymentsPage implements OnInit {
  private readonly api = inject(Api);

  readonly branches = signal<Branch[]>([]);
  readonly branchId = signal<number | null>(null);
  readonly sessions = signal<OpenSession[]>([]);
  readonly selected = signal<OpenSession | null>(null);
  readonly balance = signal<Balance | null>(null);
  readonly payments = signal<Payment[]>([]);
  readonly reconciliation = signal<any>(null);
  readonly busy = signal(false);
  readonly checking = signal<number | null>(null);
  readonly error = signal('');
  parts = 2;

  ngOnInit() {
    this.api.get<{ data: Branch[] }>('/api/platform/branches').subscribe({
      next: (r) => { this.branches.set(r.data); if (r.data[0]) this.pickBranch(r.data[0].id); },
      error: (e) => this.fail(e, 'No se pudieron cargar las sucursales.'),
    });
  }
  private fail = (e: any, m: string) => this.error.set(e?.error?.error ?? m);

  pickBranch(id: number) {
    this.branchId.set(id);
    this.selected.set(null);
    this.balance.set(null);
    this.api.get<{ data: OpenSession[] }>(`/api/tables/sessions/open?branchId=${id}`).subscribe({
      next: (r) => this.sessions.set(r.data), error: (e) => this.fail(e, 'No se pudieron cargar las mesas.'),
    });
    this.api.get<any>(`/api/payments/reconciliation?branchId=${id}`).subscribe({ next: (r) => this.reconciliation.set(r), error: () => this.reconciliation.set(null) });
  }
  select(s: OpenSession) {
    this.selected.set(s);
    this.reload();
  }
  private reload() {
    const id = this.selected()!.id;
    this.api.get<Balance>(`/api/payments/sessions/${id}/balance`).subscribe({ next: (b) => this.balance.set(b), error: (e) => this.fail(e, 'No se pudo cargar el saldo.') });
    this.api.get<{ data: Payment[] }>(`/api/payments?sessionId=${id}`).subscribe({ next: (r) => this.payments.set(r.data), error: () => {} });
  }

  chargeGroup() {
    this.run(this.api.post(`/api/payments/sessions/${this.selected()!.id}/charges`, { mode: 'GROUP', provider: 'CASH' }));
  }
  chargeIndividual(participantId: string) {
    this.run(this.api.post(`/api/payments/sessions/${this.selected()!.id}/charges`, { mode: 'INDIVIDUAL', participantId, provider: 'CASH' }));
  }
  splitEqual() {
    this.run(this.api.post(`/api/payments/sessions/${this.selected()!.id}/split-equal`, { parts: this.parts }));
  }
  refund(p: Payment) {
    const reason = prompt('Motivo de la devolución:');
    if (reason == null) return;
    this.run(this.api.post(`/api/payments/${p.id}/refund`, { reason }));
  }
  checkMpStatus(p: Payment) {
    this.error.set('');
    this.checking.set(p.id);
    this.api.post<{ foundUpdate: boolean; status: string }>(`/api/payments/${p.id}/check-mp-status`, {}).subscribe({
      next: (r) => {
        this.checking.set(null);
        if (!r.foundUpdate) this.error.set('MercadoPago todavía no tiene registrado este pago. Probá de nuevo en un momento.');
        this.reload();
        this.pickBranch(this.branchId()!);
      },
      error: (e) => { this.checking.set(null); this.fail(e, 'No se pudo verificar el pago.'); },
    });
  }

  private run(obs: import('rxjs').Observable<any>) {
    this.error.set('');
    this.busy.set(true);
    obs.subscribe({
      next: () => { this.busy.set(false); this.reload(); this.pickBranch(this.branchId()!); },
      error: (e) => { this.busy.set(false); this.fail(e, 'No se pudo completar la operación.'); },
    });
  }
}
