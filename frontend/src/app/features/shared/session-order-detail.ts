import { Component, EventEmitter, Input, OnChanges, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { CurrentUserService } from '../../core/current-user';

interface Participant { id: number; public_id: string; display_name: string; nickname: string | null; left_at: string | null; }
interface OrderItem { id: number; qty: number; name_snapshot: string; variant_snapshot: string | null; line_total: string; }
interface Product { code: string; name: string; base_price: string; currency: string; is_active: boolean; }
interface Order {
  id: number; public_id: string; participant_id: number | null; status: string;
  currency: string; total: string; items: OrderItem[];
}
interface Balance {
  currency: string; total: string; paid: string; remaining: string;
  byParticipant: { participantId: string; name: string; remaining: string }[];
}

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'badge', CONFIRMED: 'badge-info', QUEUED: 'badge-info', VALIDATING_STOCK: 'badge-info',
  PREPARING: 'badge-warning', READY: 'badge-success', DELIVERED: 'badge-success',
  COMPLETED: 'badge', CANCEL_REQUESTED: 'badge-warning', CANCELLED: 'badge-danger', REJECTED_STOCK: 'badge-danger',
};
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Sin confirmar', CONFIRMED: 'Confirmado', QUEUED: 'En cola', VALIDATING_STOCK: 'Validando stock',
  PREPARING: 'Preparando', READY: 'Listo', DELIVERED: 'Entregado', COMPLETED: 'Cerrado',
  CANCEL_REQUESTED: 'Cancelando…', CANCELLED: 'Cancelado', REJECTED_STOCK: 'Sin stock',
};
const NOT_CANCELLABLE = new Set(['READY', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'CANCEL_REQUESTED']);
// Ventana en la que un pedido ya confirmado todavía se puede tocar (ver
// STAFF_AMENDABLE_STATUSES en orders.service.js — misma frontera).
const AMENDABLE = new Set(['CONFIRMED', 'QUEUED']);

// Detalle de una mesa/sesión para STAFF: qué pidió cada uno (con nombre
// real, no sólo el total de la mesa) y una forma de arreglar un error de
// carga (cancelar un pedido ya confirmado) sin depender de que el
// comensal pueda hacerlo — una vez que el pedido salió de "sin confirmar"
// el comensal ya no puede tocarlo (cocina ya lo tiene), así que ESTE es
// el único lugar donde alguien puede corregirlo. Usado desde /staff/mesas
// y /admin/mesas — antes ninguna de las dos mostraba esto (bug real de la
// aceptación: "no he podido ver el pedido" desde administración).
@Component({
  selector: 'app-session-order-detail',
  imports: [FormsModule],
  template: `
    @if (loading()) { <p class="muted small">Cargando…</p> }
    @if (error()) { <p class="err">{{ error() }}</p> }

    @if (!loading() && !error()) {
      @if (balance(); as bal) {
        <p class="muted small totals">
          Total {{ bal.currency }} {{ bal.total }} · Pagado {{ bal.currency }} {{ bal.paid }}
          · <strong>Falta {{ bal.currency }} {{ bal.remaining }}</strong>
        </p>
      }

      @if (canSubmitAll() && hasDrafts()) {
        <button class="block submit-all-btn" [disabled]="submittingAll()" (click)="submitAll()">
          {{ submittingAll() ? 'Enviando…' : '📣 Cerrar pedidos pendientes y avisar a cocina' }}
        </button>
        @if (submitAllMsg()) { <p class="ok small">{{ submitAllMsg() }}</p> }
      }

      @for (g of groups(); track g.participantId) {
        <div class="pgroup">
          <h4>{{ g.name }}</h4>
          @for (o of g.orders; track o.id) {
            <div class="ord">
              <div class="ord-head">
                <span class="badge" [class]="badgeClass(o.status)">{{ statusLabel(o.status) }}</span>
                <span class="ord-total">{{ o.currency }} {{ o.total }}</span>
                @if (canCancel() && !notCancellable(o.status)) {
                  <button class="link danger-link" [disabled]="cancelling() === o.id" (click)="cancel(o)">
                    {{ cancelling() === o.id ? 'Cancelando…' : 'Cancelar pedido' }}
                  </button>
                }
              </div>
              <ul>
                @for (it of o.items; track it.id) {
                  <li>{{ it.qty }}× {{ it.name_snapshot }}{{ it.variant_snapshot ? ' (' + it.variant_snapshot + ')' : '' }}
                    <span class="line-right muted">
                      {{ o.currency }} {{ it.line_total }}
                      @if (canAmend() && isAmendable(o.status)) {
                        <button class="link x" [disabled]="amending() === o.id" (click)="removeItem(o, it)">quitar</button>
                      }
                    </span>
                  </li>
                } @empty { <li class="muted">Sin ítems.</li> }
              </ul>
              @if (canAmend() && isAmendable(o.status)) {
                <div class="amend-row">
                  @if (addingTo() === o.id) {
                    <select [(ngModel)]="pickCode">
                      <option value="">Elegí un producto…</option>
                      @for (p of products(); track p.code) { <option [value]="p.code">{{ p.name }} — {{ p.currency }} {{ p.base_price }}</option> }
                    </select>
                    <input type="number" min="1" [(ngModel)]="pickQty" style="width:56px" />
                    <button class="primary" [disabled]="!pickCode || amending() === o.id" (click)="addItem(o)">Agregar</button>
                    <button (click)="addingTo.set(null)">Cancelar</button>
                  } @else {
                    <button class="link" (click)="openAdd(o)">+ agregar ítem</button>
                  }
                </div>
              }
              @if (amendMsg() && amendMsgFor() === o.id) { <p class="ok small">{{ amendMsg() }}</p> }
            </div>
          }
        </div>
      } @empty { <p class="muted small">Todavía no pidieron nada.</p> }
    }
  `,
  styles: [`
    .totals { margin: 0 0 var(--space-2); }
    .pgroup { margin-bottom: var(--space-3); }
    .pgroup h4 { margin: 0 0 6px; font-size: .95rem; }
    .ord { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 10px; margin-bottom: 6px; background: var(--surface-2); }
    .ord-head { display: flex; align-items: center; gap: 8px; }
    .ord-total { font-weight: 600; }
    .danger-link { margin-left: auto; color: var(--danger); font-size: .82rem; }
    ul { margin: 6px 0 0; padding: 0; list-style: none; font-size: .85rem; display: flex; flex-direction: column; gap: 3px; }
    ul li { display: flex; justify-content: space-between; gap: 8px; }
    .line-right { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
    .x { font-size: .78rem; color: var(--danger); }
    .amend-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 6px; }
    .amend-row select { max-width: 220px; }
    .err { color: var(--danger); }
    .ok { color: var(--success); }
    .small { font-size: .85rem; }
    .submit-all-btn { margin-bottom: var(--space-3); }
  `],
})
export class SessionOrderDetail implements OnChanges {
  @Input({ required: true }) sessionId!: number;
  @Output() changed = new EventEmitter<void>();

  private readonly api = inject(Api);
  private readonly currentUser = inject(CurrentUserService);

  readonly loading = signal(true);
  readonly error = signal('');
  readonly participants = signal<Participant[]>([]);
  readonly orders = signal<Order[]>([]);
  readonly balance = signal<Balance | null>(null);
  readonly cancelling = signal<number | null>(null);
  readonly submittingAll = signal(false);
  readonly submitAllMsg = signal('');

  // "Quién puede modificar la orden [ya confirmada] y cargar la
  // modificación para que paguen la diferencia" (pedido en la
  // aceptación). El total de la mesa se recalcula solo al agregar/sacar
  // — el saldo nuevo ya lo cobra/devuelve el circuito de pagos existente
  // (Caja), no hace falta nada especial acá para la plata en sí.
  readonly products = signal<Product[]>([]);
  readonly addingTo = signal<number | null>(null);
  readonly amending = signal<number | null>(null);
  readonly amendMsg = signal('');
  readonly amendMsgFor = signal<number | null>(null);
  pickCode = '';
  pickQty = 1;

  canCancel() { return this.currentUser.hasPermission('orders:cancel'); }
  canSubmitAll() { return this.currentUser.hasPermission('orders:create'); }
  canAmend() { return this.currentUser.hasPermission('orders:amend_paid'); }
  isAmendable(status: string) { return AMENDABLE.has(status); }
  hasDrafts() { return this.orders().some((o) => o.status === 'DRAFT'); }
  badgeClass(s: string) { return STATUS_BADGE[s] ?? 'badge'; }
  statusLabel(s: string) { return STATUS_LABEL[s] ?? s; }
  notCancellable(s: string) { return NOT_CANCELLABLE.has(s); }

  ngOnChanges() { this.load(); }

  load() {
    if (!this.sessionId) return;
    this.loading.set(true);
    this.error.set('');
    this.api.get<{ participants: Participant[] }>(`/api/tables/sessions/${this.sessionId}`).subscribe({
      next: (s) => { this.participants.set(s.participants ?? []); this.loading.set(false); },
      error: (e) => { this.error.set(e?.error?.error ?? 'No se pudo cargar la mesa.'); this.loading.set(false); },
    });
    this.api.get<{ data: Order[] }>(`/api/orders?sessionId=${this.sessionId}`).subscribe({
      next: (r) => this.orders.set(r.data),
      error: () => this.orders.set([]),
    });
    if (this.currentUser.hasPermission('payments:view')) {
      this.api.get<Balance>(`/api/payments/sessions/${this.sessionId}/balance`).subscribe({
        next: (b) => this.balance.set(b),
        error: () => this.balance.set(null),
      });
    }
  }

  // Confirmación pedida explícitamente: cerrar los pedidos de una mesa
  // entera no es una acción trivial para deshacer (ya salió hacia cocina).
  submitAll() {
    if (!confirm('¿Confirmar y enviar a cocina TODOS los pedidos sin confirmar de esta mesa?')) return;
    this.submitAllMsg.set('');
    this.submittingAll.set(true);
    this.api.post<{ submitted: number[]; skipped: any[] }>(`/api/orders/sessions/${this.sessionId}/submit-all`, {}).subscribe({
      next: (r) => {
        this.submittingAll.set(false);
        this.submitAllMsg.set(r.submitted.length ? `Listo — ${r.submitted.length} pedido(s) enviados a cocina.` : 'No había nada pendiente.');
        this.load();
        this.changed.emit();
      },
      error: (e) => { this.submittingAll.set(false); this.error.set(e?.error?.error ?? 'No se pudo enviar.'); },
    });
  }

  private participantName(pid: number | null): string {
    if (pid == null) return 'Mostrador';
    const p = this.participants().find((x) => x.id === pid);
    return p ? (p.nickname || p.display_name) : 'Invitado';
  }

  groups() {
    const byId = new Map<string, { participantId: string; name: string; orders: Order[] }>();
    for (const o of this.orders()) {
      const key = String(o.participant_id ?? 'counter');
      if (!byId.has(key)) byId.set(key, { participantId: key, name: this.participantName(o.participant_id), orders: [] });
      byId.get(key)!.orders.push(o);
    }
    return [...byId.values()];
  }

  openAdd(o: Order) {
    this.pickCode = '';
    this.pickQty = 1;
    this.addingTo.set(o.id);
    if (!this.products().length) {
      this.api.get<{ data: Product[] }>('/api/catalog/products').subscribe({
        next: (r) => this.products.set(r.data.filter((p) => p.is_active)),
        error: () => this.products.set([]),
      });
    }
  }

  addItem(o: Order) {
    if (!this.pickCode) return;
    this.error.set('');
    this.amending.set(o.id);
    this.api.post(`/api/orders/${o.id}/items`, { productCode: this.pickCode, qty: this.pickQty || 1 }).subscribe({
      next: () => {
        this.amending.set(null);
        this.addingTo.set(null);
        this.amendMsg.set('Agregado — el saldo de la mesa ya lo refleja.');
        this.amendMsgFor.set(o.id);
        this.load();
        this.changed.emit();
      },
      error: (e) => { this.amending.set(null); this.error.set(e?.error?.error ?? 'No se pudo agregar el ítem.'); },
    });
  }

  removeItem(o: Order, it: OrderItem) {
    if (!confirm(`¿Sacar "${it.name_snapshot}" de este pedido?`)) return;
    this.error.set('');
    this.amending.set(o.id);
    this.api.delete(`/api/orders/${o.id}/items/${it.id}`).subscribe({
      next: () => {
        this.amending.set(null);
        this.amendMsg.set('Sacado — el saldo de la mesa ya lo refleja.');
        this.amendMsgFor.set(o.id);
        this.load();
        this.changed.emit();
      },
      error: (e) => { this.amending.set(null); this.error.set(e?.error?.error ?? 'No se pudo sacar el ítem.'); },
    });
  }

  cancel(o: Order) {
    const reason = prompt('Motivo de la cancelación:');
    if (reason == null) return;
    this.error.set('');
    this.cancelling.set(o.id);
    this.api.post(`/api/orders/${o.id}/cancel`, { reason }).subscribe({
      next: () => { this.cancelling.set(null); this.load(); this.changed.emit(); },
      error: (e) => { this.cancelling.set(null); this.error.set(e?.error?.error ?? 'No se pudo cancelar el pedido.'); },
    });
  }
}
