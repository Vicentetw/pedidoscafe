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

const STATUS_LABEL: Record<string, string> = {
  CREATED: 'Iniciado', PENDING: 'Pendiente', APPROVED: 'Aprobado', SETTLED: 'Acreditado',
  REJECTED: 'Rechazado', EXPIRED: 'Vencido', CANCELLED: 'Cancelado',
  REFUNDED: 'Devuelto', PARTIALLY_REFUNDED: 'Devuelto parcial',
};

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

    <div class="tabs">
      <button [class.active]="mode() === 'mesas'" (click)="mode.set('mesas')">Mesas abiertas</button>
      <button [class.active]="mode() === 'historial'" (click)="showHistory()">Historial de pagos</button>
    </div>

    @if (mode() === 'mesas') {
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
              @if (cashPrompt(); as cp) {
                <div class="card cash-modal">
                  <h4>Cobrar en efectivo — {{ cp.label }}</h4>
                  <p>Monto a cobrar: <strong>{{ bal.currency }} {{ cp.amountDue.toFixed(2) }}</strong></p>
                  <label>Monto que entrega el cliente (opcional — dejalo vacío si entrega justo)
                    <input type="number" min="0" step="0.01" [(ngModel)]="tendered" [placeholder]="cp.amountDue.toFixed(2)" />
                  </label>
                  @if (changeAmount(cp) > 0) {
                    <p class="ok">Vuelto a entregar: <strong>{{ bal.currency }} {{ changeAmount(cp).toFixed(2) }}</strong></p>
                  }
                  @if (tenderedShort(cp)) {
                    <p class="err">Lo que entrega es menos de lo que falta cobrar — pedile el resto o cancelá.</p>
                  }
                  <div class="row">
                    <button class="primary" [disabled]="busy() || tenderedShort(cp)" (click)="confirmCash(cp)">
                      {{ busy() ? 'Cobrando…' : 'Confirmar cobro' }}
                    </button>
                    <button [disabled]="busy()" (click)="cashPrompt.set(null)">Cancelar</button>
                  </div>
                </div>
              } @else {
                <div class="row">
                  <button class="primary" [disabled]="busy()" (click)="openCash('GROUP', 'Toda la mesa', +bal.remaining)">Cobrar todo (efectivo)</button>
                  <input type="number" placeholder="partes" [(ngModel)]="parts" style="max-width:90px" />
                  <button [disabled]="busy()" (click)="splitEqual()">Dividir en partes iguales</button>
                </div>
                <h4>Por persona</h4>
                <ul>
                  @for (p of bal.byParticipant; track p.participantId) {
                    <li>
                      {{ p.name }}: debe {{ bal.currency }} {{ p.remaining }}
                      @if (+p.remaining > 0) {
                        <button (click)="openCash('INDIVIDUAL', p.name, +p.remaining, p.participantId)">Cobrar (efectivo)</button>
                      }
                    </li>
                  }
                </ul>
              }
            } @else {
              <p class="muted">Saldada.</p>
            }

            <h4>Pagos</h4>
            <table style="width:100%; border-collapse:collapse;">
              <thead><tr><th>Cuándo</th><th>Modo</th><th>Medio</th><th>Monto</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                @for (p of payments(); track p.id) {
                  <tr>
                    <td>{{ p.created_at }}</td><td>{{ p.kind }}</td><td>{{ p.provider }}</td><td>{{ p.amount }}</td><td>{{ statusLabel(p.status) }}</td>
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
    } @else {
      <div class="card">
        <h3>Historial de pagos</h3>
        <p class="muted small">Todos los pagos de la sucursal, más allá de qué mesa quedó abierta — pensado para revisar el día (pueden ser cientos).</p>
        <div class="row filters">
          <label class="flabel">Desde <input type="date" [(ngModel)]="historyFrom" (change)="loadHistory()" /></label>
          <label class="flabel">Hasta <input type="date" [(ngModel)]="historyTo" (change)="loadHistory()" /></label>
          <select [(ngModel)]="historyStatus" (ngModelChange)="loadHistory()">
            <option [ngValue]="''">Todos los estados</option>
            @for (st of statusOptions; track st) { <option [ngValue]="st">{{ statusLabel(st) }}</option> }
          </select>
        </div>
        <table style="width:100%; border-collapse:collapse;">
          <thead><tr><th>Cuándo</th><th>Modo</th><th>Medio</th><th>Monto</th><th>Estado</th></tr></thead>
          <tbody>
            @for (p of historyPayments(); track p.id) {
              <tr>
                <td>{{ p.created_at }}</td><td>{{ p.kind }}</td><td>{{ p.provider }}</td><td>{{ p.amount }}</td><td>{{ statusLabel(p.status) }}</td>
              </tr>
            } @empty { <tr><td colspan="5" class="muted">Sin pagos en este rango.</td></tr> }
          </tbody>
        </table>
        <div class="row pager">
          <button [disabled]="historyOffset === 0" (click)="historyPrev()">‹ Anteriores</button>
          <span class="muted small">{{ historyRangeLabel() }}</span>
          <button [disabled]="!historyHasMore()" (click)="historyNext()">Siguientes ›</button>
        </div>
      </div>
    }
  `,
  styles: [`
    .cols { display:grid; grid-template-columns: 260px 1fr; gap:16px; }
    @media (max-width: 720px) { .cols { grid-template-columns: 1fr; } }
    ul { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:4px; }
    button.link { border:none; background:none; text-align:left; padding:6px; color:var(--text); width:100%; border-radius:8px; }
    button.link.sel, button.link:hover { background: var(--border); }
    .row { display:flex; gap:8px; flex-wrap:wrap; margin: 10px 0; align-items:center; }
    h4 { margin: 14px 0 4px; }
    .tabs { display:flex; gap:6px; margin-bottom: var(--space-4); }
    .tabs button { border-radius: var(--radius-pill); padding: 0.5rem 1rem; background: var(--surface-2); border-color: transparent; }
    .tabs button.active { background: var(--primary); color: var(--primary-contrast); }
    .filters { align-items: flex-end; }
    .flabel { display: flex; flex-direction: column; gap: 4px; font-size: .85rem; color: var(--muted); }
    .flabel input { width: auto; }
    .pager { justify-content: space-between; }
    .err { color: var(--danger); }
    .ok { color: var(--success); }
    .cash-modal { background: var(--surface-2); gap: var(--space-2); display: flex; flex-direction: column; }
    .cash-modal label { display: flex; flex-direction: column; gap: 4px; font-size: .85rem; color: var(--muted); }
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

  // -------- historial de pagos de la sucursal (no sólo la mesa seleccionada)
  readonly mode = signal<'mesas' | 'historial'>('mesas');
  readonly historyPayments = signal<Payment[]>([]);
  readonly historyTotal = signal(0);
  readonly historyLimit = 50;
  historyOffset = 0;
  historyFrom = '';
  historyTo = '';
  historyStatus = '';
  readonly statusOptions = Object.keys(STATUS_LABEL);

  statusLabel(s: string) { return STATUS_LABEL[s] ?? s; }

  showHistory() {
    this.mode.set('historial');
    this.historyOffset = 0;
    this.loadHistory();
  }
  loadHistory() {
    if (!this.branchId()) return;
    this.historyOffset = 0;
    this.fetchHistory();
  }
  private fetchHistory() {
    const params = new URLSearchParams({
      branchId: String(this.branchId()),
      limit: String(this.historyLimit),
      offset: String(this.historyOffset),
    });
    if (this.historyFrom) params.set('from', this.historyFrom);
    if (this.historyTo) params.set('to', this.historyTo + ' 23:59:59');
    if (this.historyStatus) params.set('status', this.historyStatus);
    this.api.get<{ data: Payment[]; total: number }>(`/api/payments?${params}`).subscribe({
      next: (r) => { this.historyPayments.set(r.data); this.historyTotal.set(r.total); },
      error: (e) => this.fail(e, 'No se pudo cargar el historial.'),
    });
  }
  historyHasMore() { return this.historyOffset + this.historyLimit < this.historyTotal(); }
  historyNext() { this.historyOffset += this.historyLimit; this.fetchHistory(); }
  historyPrev() { this.historyOffset = Math.max(0, this.historyOffset - this.historyLimit); this.fetchHistory(); }
  historyRangeLabel() {
    const total = this.historyTotal();
    if (!total) return 'Sin pagos';
    const from = this.historyOffset + 1;
    const to = Math.min(this.historyOffset + this.historyLimit, total);
    return `${from}–${to} de ${total}`;
  }

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
    if (this.mode() === 'historial') this.loadHistory();
  }
  select(s: OpenSession) {
    this.selected.set(s);
    this.cashPrompt.set(null);
    this.reload();
  }
  private reload() {
    const id = this.selected()!.id;
    this.api.get<Balance>(`/api/payments/sessions/${id}/balance`).subscribe({ next: (b) => this.balance.set(b), error: (e) => this.fail(e, 'No se pudo cargar el saldo.') });
    this.api.get<{ data: Payment[] }>(`/api/payments?sessionId=${id}`).subscribe({ next: (r) => this.payments.set(r.data), error: () => {} });
  }

  // -------- cobro en efectivo: monto que entrega el cliente + vuelto ----
  // El backend siempre cobra el saldo EXACTO (nunca de más ni de menos) —
  // "lo que entrega" es sólo para calcularle el vuelto al cajero, no cambia
  // el monto que se registra como pagado.
  readonly cashPrompt = signal<{ kind: 'GROUP' | 'INDIVIDUAL'; label: string; amountDue: number; participantId?: string } | null>(null);
  tendered = '';

  openCash(kind: 'GROUP' | 'INDIVIDUAL', label: string, amountDue: number, participantId?: string) {
    this.error.set('');
    this.tendered = '';
    this.cashPrompt.set({ kind, label, amountDue, participantId });
  }
  changeAmount(cp: { amountDue: number }): number {
    const t = Number(this.tendered);
    return t > cp.amountDue ? t - cp.amountDue : 0;
  }
  tenderedShort(cp: { amountDue: number }): boolean {
    const t = Number(this.tendered);
    return this.tendered.trim() !== '' && t > 0 && t < cp.amountDue;
  }
  confirmCash(cp: { kind: 'GROUP' | 'INDIVIDUAL'; label: string; amountDue: number; participantId?: string }) {
    if (this.tenderedShort(cp)) return;
    const change = this.changeAmount(cp);
    const changeMsg = change > 0 ? ` Vuelto: ${change.toFixed(2)}.` : '';
    if (!confirm(`¿Confirmás el cobro en efectivo de ${cp.amountDue.toFixed(2)} — ${cp.label}?${changeMsg}`)) return;
    const body: any = { mode: cp.kind, provider: 'CASH' };
    if (cp.kind === 'INDIVIDUAL') body.participantId = cp.participantId;
    this.error.set('');
    this.busy.set(true);
    this.api.post(`/api/payments/sessions/${this.selected()!.id}/charges`, body).subscribe({
      next: () => { this.busy.set(false); this.cashPrompt.set(null); this.reload(); this.pickBranch(this.branchId()!); },
      error: (e) => { this.busy.set(false); this.fail(e, 'No se pudo completar el cobro.'); },
    });
  }
  splitEqual() {
    if (!confirm(`¿Confirmás dividir la cuenta en ${this.parts} partes iguales y cobrarlas en efectivo?`)) return;
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
