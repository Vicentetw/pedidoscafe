import { Component, EventEmitter, Input, OnChanges, Output, inject, signal } from '@angular/core';
import { Api } from '../../core/api';
import { CurrentUserService } from '../../core/current-user';

interface Participant { id: number; public_id: string; display_name: string; nickname: string | null; left_at: string | null; }
interface OrderItem { id: number; qty: number; name_snapshot: string; variant_snapshot: string | null; line_total: string; }
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
                    <span class="muted">{{ o.currency }} {{ it.line_total }}</span>
                  </li>
                } @empty { <li class="muted">Sin ítems.</li> }
              </ul>
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
    .err { color: var(--danger); }
    .small { font-size: .85rem; }
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

  canCancel() { return this.currentUser.hasPermission('orders:cancel'); }
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
