import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TableSessionService } from '../../core/table-session';

interface MenuProduct { code: string; name: string; price: string; currency: string; available: boolean; variants: { code: string; name: string; price: string }[]; }
interface MenuCat { code: string; name: string; icon: string | null; products: MenuProduct[]; }

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'badge', CONFIRMED: 'badge-info', QUEUED: 'badge-info', PREPARING: 'badge-warning',
  READY: 'badge-success', DELIVERED: 'badge-success', COMPLETED: 'badge', CANCELLED: 'badge-danger',
};

// Panel de pedido del comensal: menú -> tocar para sumar a un borrador ->
// confirmar -> seguimiento. El precio siempre viene del backend.
@Component({
  selector: 'app-order-panel',
  imports: [FormsModule],
  template: `
    @if (orders()?.mine?.length) {
      <div class="card">
        <h3>Mis pedidos</h3>
        @for (o of orders()?.mine ?? []; track o.public_id) {
          <div class="ord">
            <div class="ord-head">
              <strong>#{{ o.public_id.slice(-5) }}</strong>
              <span class="badge" [class]="badgeClass(o.status)">{{ label(o.status) }}</span>
              <span class="ord-total">{{ o.currency }} {{ o.total }}</span>
            </div>
            <ul>
              @for (it of o.items; track it.id) {
                <li>
                  <span>{{ it.qty }}× {{ it.name_snapshot }}{{ it.variant_snapshot ? ' (' + it.variant_snapshot + ')' : '' }}</span>
                  <span class="line-right">
                    {{ o.currency }} {{ it.line_total }}
                    @if (o.status === 'DRAFT') { <button class="link x" (click)="remove(o, it.id)">quitar</button> }
                  </span>
                </li>
              }
            </ul>
            @if (o.status === 'DRAFT') {
              <button class="primary block" [disabled]="!o.items.length || busy()" (click)="submit(o)">Confirmar este pedido</button>
            }
          </div>
        }
        @if (orders()?.someoneElseOrdering?.length) {
          <p class="muted small">Hay otra persona armando un pedido en esta mesa.</p>
        }
        <p class="muted small total-line">Total de la mesa: <strong>{{ orders()?.currency }} {{ orders()?.tableTotal }}</strong></p>
      </div>
    }

    @if (hasBalance() && remaining() > 0) {
      <div class="card">
        <h3>Pagar</h3>
        <p class="muted small">Saldo pendiente de la mesa: <strong>{{ balance()?.currency }} {{ balance()?.remaining }}</strong></p>
        @if (payError()) { <p class="err">{{ payError() }}</p> }
        <div class="row">
          <button class="primary" [disabled]="payBusy()" (click)="pay('INDIVIDUAL')">Pagar mi parte</button>
          <button [disabled]="payBusy()" (click)="pay('GROUP')">Pagar toda la mesa</button>
        </div>
        <p class="muted small">Se paga online (MercadoPago).</p>
      </div>
    } @else if (hasBalance()) {
      <div class="card paid-card"><p class="muted small">La mesa ya está saldada 🎉</p></div>
    }

    <div class="card menu-card">
      <h3>Menú</h3>
      @if (menuLoading()) { <p class="muted">Cargando…</p> }
      @for (cat of cats(); track cat.code) {
        <h4>{{ cat.icon || '' }} {{ cat.name }}</h4>
        @for (p of cat.products; track p.code) {
          <div class="mi" [class.off]="!p.available">
            <div class="mi-info">
              <span class="name">{{ p.name }}</span>
              <span class="price muted">{{ p.currency }} {{ p.price }}</span>
            </div>
            @if (p.available) {
              @if (p.variants.length) {
                @if (expanded.has(p.code)) {
                  <div class="chips">
                    @for (vr of p.variants; track vr.code) {
                      <button class="chip" (click)="add(p.code, vr.code)">{{ vr.name }} · {{ p.currency }} {{ vr.price }}</button>
                    }
                  </div>
                } @else {
                  <button class="pick-btn" (click)="toggle(p.code)">Elegir</button>
                }
              } @else {
                <button class="add-btn" (click)="add(p.code, null)" [attr.aria-label]="'Agregar ' + p.name">+</button>
              }
            } @else { <span class="badge">Sin stock</span> }
          </div>
        }
      }
    </div>
    @if (error()) { <p class="err">{{ error() }}</p> }
  `,
  styles: [`
    .card { margin-bottom: var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }
    .ord { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px; margin-bottom: 8px; background: var(--surface-2); }
    .ord-head { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
    .ord-total { font-weight: 600; margin-left: auto; }
    ul { margin: 8px 0; padding: 0; list-style: none; font-size: .88rem; display: flex; flex-direction: column; gap: 4px; }
    ul li { display: flex; justify-content: space-between; gap: 8px; }
    .line-right { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
    .x { font-size: .78rem; }
    .block { width: 100%; margin-top: 6px; }
    .total-line { margin: 4px 0 0; text-align: right; }
    .paid-card { background: var(--success-soft); border-color: transparent; }
    .err { color: var(--danger); font-size: .9rem; }
    .small { font-size: .85rem; margin: 0; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; }

    .menu-card h4:first-of-type { margin-top: 0; }
    .mi { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border); }
    .mi:last-child { border-bottom: none; }
    .mi.off { opacity: .5; }
    .mi-info { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
    .mi .name { font-weight: 600; }
    .price { font-size: .85rem; }

    .add-btn {
      flex-shrink: 0; width: 38px; height: 38px; min-height: 38px; padding: 0;
      border-radius: 50%; font-size: 1.3rem; line-height: 1; font-weight: 400;
      background: var(--primary-soft); color: var(--primary-hover); border: none;
    }
    .add-btn:hover { background: var(--primary); color: var(--primary-contrast); }
    .pick-btn { flex-shrink: 0; font-size: .85rem; padding: 0.45rem 0.8rem; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; max-width: 60%; justify-content: flex-end; }
    .chip {
      font-size: .8rem; padding: 0.4rem 0.7rem; border-radius: var(--radius-pill);
      background: var(--primary-soft); border-color: transparent; color: var(--primary-hover);
    }
    .chip:hover { background: var(--primary); color: var(--primary-contrast); }
  `],
})
export class OrderPanel implements OnInit {
  @Input({ required: true }) tenantSlug!: string;
  @Input({ required: true }) branchCode!: string;
  private readonly svc = inject(TableSessionService);

  readonly cats = signal<MenuCat[]>([]);
  readonly orders = signal<any>(null);
  readonly menuLoading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly balance = signal<any>(null);
  readonly hasBalance = () => this.balance() != null;
  readonly remaining = () => Number(this.balance()?.remaining ?? 0);
  readonly payBusy = signal(false);
  readonly payError = signal('');
  readonly expanded = new Set<string>();
  private draftId: number | null = null;

  badgeClass(status: string) { return STATUS_BADGE[status] ?? 'badge'; }
  toggle(code: string) { this.expanded.has(code) ? this.expanded.delete(code) : this.expanded.add(code); }

  label(s: string) {
    return { DRAFT: 'Sin confirmar', CONFIRMED: 'Confirmado', QUEUED: 'En cola', PREPARING: 'Preparando', READY: 'Listo', DELIVERED: 'Entregado', COMPLETED: 'Cerrado', CANCELLED: 'Cancelado' }[s] ?? s;
  }

  async ngOnInit() {
    try {
      const menu = await this.svc.menu(this.tenantSlug, this.branchCode);
      this.cats.set((menu.menus ?? []).flatMap((m: any) => m.categories));
    } catch { this.error.set('No se pudo cargar el menú.'); }
    this.menuLoading.set(false);
    await this.refreshOrders();
    await this.refreshBalance();
  }

  private async refreshBalance() {
    try { this.balance.set(await this.svc.balance()); } catch { /* ignore */ }
  }

  async pay(mode: 'GROUP' | 'INDIVIDUAL') {
    this.payError.set('');
    this.payBusy.set(true);
    try {
      const res = await this.svc.pay(mode);
      if (res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
      } else {
        this.payError.set('El pago quedó iniciado. Actualizá en un momento.');
      }
    } catch (e: any) {
      this.payError.set(e?.error?.error ?? 'No se pudo iniciar el pago. Probá de nuevo.');
    } finally {
      this.payBusy.set(false);
      await this.refreshBalance();
    }
  }

  private async refreshOrders() {
    try {
      const r = await this.svc.myOrders();
      this.orders.set(r);
      const openDraft = (r.mine ?? []).find((o: any) => o.status === 'DRAFT');
      this.draftId = openDraft ? openDraft.id : null;
    } catch { /* ignore */ }
  }

  private async ensureDraft() {
    if (this.draftId) return this.draftId;
    const o = await this.svc.createOrder();
    this.draftId = o.id;
    return this.draftId;
  }

  async add(productCode: string, variantCode: string | null) {
    this.error.set('');
    this.busy.set(true);
    this.expanded.delete(productCode);
    try {
      const id = await this.ensureDraft();
      await this.svc.addOrderItem(id!, { productCode, variantCode: variantCode || null, qty: 1 });
      await this.refreshOrders();
    } catch (e: any) {
      this.error.set(e?.error?.error ?? 'No se pudo agregar.');
    } finally { this.busy.set(false); }
  }

  async remove(order: any, itemId: number) {
    await this.svc.removeOrderItem(order.id, itemId).catch(() => {});
    await this.refreshOrders();
  }

  async submit(order: any) {
    this.error.set('');
    this.busy.set(true);
    try {
      await this.svc.submitOrder(order.id);
      this.draftId = null;
      await this.refreshOrders();
      await this.refreshBalance();
      await this.svc.refresh();
    } catch (e: any) {
      this.error.set(e?.error?.error ?? 'No se pudo confirmar el pedido.');
      await this.refreshOrders();
    } finally { this.busy.set(false); }
  }
}
