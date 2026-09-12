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
              @if (confirmingId() === o.id) {
                <p class="muted small confirm-msg">Estás a punto de pedir esto. Una vez confirmado, cocina ya lo recibe y no se puede sacar solo/a — ¿confirmás?</p>
                <div class="row">
                  <button class="primary" [disabled]="busy()" (click)="submit(o)">Sí, confirmar pedido</button>
                  <button [disabled]="busy()" (click)="confirmingId.set(null)">Modificar</button>
                </div>
              } @else {
                <button class="primary block" [disabled]="!o.items.length || busy()" (click)="confirmingId.set(o.id)">Revisar y confirmar</button>
              }
            }
          </div>
        }
        @if (orders()?.someoneElseOrdering?.length) {
          <p class="muted small">Hay otra persona armando un pedido en esta mesa.</p>
        }
        <p class="muted small total-line">Total de la mesa: <strong>{{ orders()?.currency }} {{ orders()?.tableTotal }}</strong></p>
        @if (closeAllMsg()) { <p class="ok small">{{ closeAllMsg() }}</p> }
        <button class="block close-all-btn" [disabled]="closingAll()" (click)="closeAll()">
          ✅ Ya pedimos todo — avisar a cocina
        </button>
      </div>
    }

    @if (hasBalance() && remaining() > 0) {
      <div class="card">
        <h3>Pagar</h3>
        <p class="muted small">Saldo pendiente de la mesa: <strong>{{ balance()?.currency }} {{ balance()?.remaining }}</strong></p>
        @if (payError()) { <p class="err">{{ payError() }}</p> }
        <div class="row">
          <button class="primary" [disabled]="payBusy() || !myShare()" (click)="pay('INDIVIDUAL')">
            Pagar mi parte @if (myShare(); as m) { — {{ balance()?.currency }} {{ m }} }
          </button>
          <button [disabled]="payBusy()" (click)="pay('GROUP')">Pagar todo — {{ balance()?.currency }} {{ balance()?.remaining }}</button>
        </div>
        <p class="muted small">Se paga online (MercadoPago).</p>
      </div>
    } @else if (hasBalance() && hasTotal()) {
      <div class="card paid-card"><p class="muted small">La mesa ya está saldada 🎉</p></div>
    }

    <div class="card menu-card">
      <div class="menu-head">
        <h3>Menú</h3>
        <div class="view-toggle">
          <button [class.active]="viewMode() === 'grid'" (click)="viewMode.set('grid')" aria-label="Ver en cuadrícula" title="Cuadrícula">▦</button>
          <button [class.active]="viewMode() === 'list'" (click)="viewMode.set('list')" aria-label="Ver en lista" title="Lista">☰</button>
        </div>
      </div>
      @if (menuLoading()) { <p class="muted">Cargando…</p> }
      @if (cats().length) {
        <div class="cat-scroller">
          <button class="cat-chip" [class.active]="activeCat() === null" (click)="activeCat.set(null)">Todos</button>
          @for (cat of cats(); track cat.code) {
            <button class="cat-chip" [class.active]="activeCat() === cat.code" (click)="activeCat.set(cat.code)">
              @if (cat.icon) { <span class="chip-icon">{{ cat.icon }}</span> }{{ cat.name }}
            </button>
          }
        </div>
      }
      @for (cat of visibleCats(); track cat.code) {
        @if (!activeCat()) { <h4>{{ cat.icon || '' }} {{ cat.name }}</h4> }
        <div [class]="viewMode() === 'grid' ? 'pgrid' : 'plist'">
          @for (p of cat.products; track p.code) {
            @if (viewMode() === 'grid') {
              <div class="pcard" [class.off]="!p.available">
                <div class="pcard-icon">{{ cat.icon || '🍽️' }}</div>
                <div class="pcard-name">{{ p.name }}</div>
                <div class="pcard-price">{{ p.currency }} {{ p.price }}</div>
                @if (p.available) {
                  @if (p.variants.length) {
                    @if (expanded.has(p.code)) {
                      <div class="chips card-chips">
                        @for (vr of p.variants; track vr.code) {
                          <button class="chip" (click)="add(p.code, vr.code)">{{ vr.name }} · {{ p.currency }} {{ vr.price }}</button>
                        }
                      </div>
                    } @else {
                      <button class="pick-btn card-pick" (click)="toggle(p.code)">Elegir</button>
                    }
                  } @else {
                    <button class="add-btn card-add" (click)="add(p.code, null)" [attr.aria-label]="'Agregar ' + p.name">+</button>
                  }
                } @else { <span class="badge off-badge">Sin stock</span> }
              </div>
            } @else {
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
    .ok { color: var(--success); font-size: .9rem; }
    .close-all-btn { margin-top: 4px; }
    .confirm-msg { margin: 6px 0; }
    .small { font-size: .85rem; margin: 0; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; }

    .menu-head { display: flex; justify-content: space-between; align-items: center; }
    .menu-head h3 { margin: 0; }
    .view-toggle { display: flex; gap: 4px; }
    .view-toggle button {
      width: 34px; height: 34px; padding: 0; border-radius: var(--radius-sm);
      background: var(--surface-2); border-color: transparent; font-size: 1rem; color: var(--muted);
    }
    .view-toggle button.active { background: var(--primary-soft); color: var(--primary-hover); }

    .cat-scroller {
      display: flex; gap: 8px; overflow-x: auto; padding: 2px 0 6px; margin-bottom: var(--space-2);
      scrollbar-width: none;
    }
    .cat-scroller::-webkit-scrollbar { display: none; }
    .cat-chip {
      flex-shrink: 0; white-space: nowrap; padding: 0.45rem 0.9rem; border-radius: var(--radius-pill);
      background: var(--surface-2); border-color: transparent; font-size: .85rem;
    }
    .cat-chip.active { background: var(--primary); color: var(--primary-contrast); }
    .chip-icon { margin-right: 4px; }

    .menu-card h4:first-of-type { margin-top: 0; }
    .mi { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border); }
    .mi:last-child { border-bottom: none; }
    .mi.off { opacity: .5; }
    .mi-info { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
    .mi .name { font-weight: 600; }
    .price { font-size: .85rem; }

    /* vista en cuadrícula — misma acción (agregar/elegir variante), sólo
       cambia la presentación; responsive solo (auto-fill, sin media queries) */
    .pgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin-bottom: var(--space-3); }
    .pcard {
      position: relative; display: flex; flex-direction: column; gap: 4px; min-height: 128px;
      padding: 10px; padding-bottom: 44px; border-radius: var(--radius-sm);
      background: var(--surface-2); border: 1px solid var(--border);
    }
    .pcard.off { opacity: .5; }
    .pcard-icon {
      width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center;
      font-size: 1.3rem; background: var(--primary-soft); margin-bottom: 2px;
    }
    .pcard-name { font-weight: 600; font-size: .88rem; line-height: 1.25; }
    .pcard-price { font-size: .82rem; color: var(--muted); }
    .off-badge { align-self: flex-start; }

    .add-btn, .card-add {
      flex-shrink: 0; width: 38px; height: 38px; min-height: 38px; padding: 0;
      border-radius: 50%; font-size: 1.3rem; line-height: 1; font-weight: 400;
      background: var(--primary-soft); color: var(--primary-hover); border: none;
    }
    .add-btn:hover, .card-add:hover { background: var(--primary); color: var(--primary-contrast); }
    .card-add, .card-pick { position: absolute; right: 10px; bottom: 10px; }
    .pick-btn, .card-pick { flex-shrink: 0; font-size: .85rem; padding: 0.45rem 0.8rem; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; max-width: 60%; justify-content: flex-end; }
    .card-chips { position: absolute; left: 10px; right: 10px; bottom: 10px; max-width: none; }
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
  readonly confirmingId = signal<number | null>(null);
  readonly closingAll = signal(false);
  readonly closeAllMsg = signal('');
  readonly error = signal('');
  readonly balance = signal<any>(null);
  readonly hasBalance = () => this.balance() != null;
  readonly remaining = () => Number(this.balance()?.remaining ?? 0);
  // "Saldada" sólo tiene sentido si HABÍA algo que pagar — si todavía no
  // se confirmó ningún pedido, total=0 y remaining=0 por igual, pero eso
  // no es "ya pagaste", es "todavía no pediste nada" (bug real reportado:
  // el mensaje aparecía apenas se entraba a la mesa, antes de pedir nada).
  readonly hasTotal = () => Number(this.balance()?.total ?? 0) > 0;
  // Cuánto falta pagar de MI parte puntual (no el total de la mesa) — se
  // busca cruzando "quién soy" (participants[].isYou) contra
  // balance().byParticipant, que viene indexado por el mismo public_id.
  myShare(): string | null {
    const me = this.svc.state()?.participants?.find((p) => p.isYou);
    const row = me ? this.balance()?.byParticipant?.find((b: any) => b.participantId === me.id) : null;
    return row && Number(row.remaining) > 0 ? row.remaining : null;
  }
  readonly payBusy = signal(false);
  readonly payError = signal('');
  readonly expanded = new Set<string>();
  private draftId: number | null = null;

  // Cuadrícula (tarjetas) o lista, y filtro por categoría (chips con
  // scroll horizontal) — pedido explícito de diseño: null = "Todos".
  readonly viewMode = signal<'grid' | 'list'>('grid');
  readonly activeCat = signal<string | null>(null);
  visibleCats() {
    const c = this.activeCat();
    return c ? this.cats().filter((x) => x.code === c) : this.cats();
  }

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
      this.confirmingId.set(null);
      await this.refreshOrders();
      await this.refreshBalance();
      await this.svc.refresh();
    } catch (e: any) {
      this.error.set(e?.error?.error ?? 'No se pudo confirmar el pedido.');
      await this.refreshOrders();
    } finally { this.busy.set(false); }
  }

  // "Ya pedimos todo" — confirma de una vez los pedidos sin confirmar de
  // TODA la mesa (no sólo los míos), para que quede claro para cocina que
  // ya pueden empezar a servir.
  async closeAll() {
    const warn = this.orders()?.someoneElseOrdering?.length
      ? 'Ojo: alguien más todavía está armando su pedido — igual se va a confirmar todo lo que haya cargado hasta ahora. '
      : '';
    if (!confirm(`${warn}¿Confirmamos y avisamos a cocina que ya terminamos de pedir?`)) return;
    this.closeAllMsg.set('');
    this.closingAll.set(true);
    try {
      const r = await this.svc.closeAllOrders();
      this.closeAllMsg.set(
        r.submitted.length ? `Listo — se avisó a cocina (${r.submitted.length} pedido(s)).` : 'Ya estaba todo confirmado.'
      );
      await this.refreshOrders();
      await this.refreshBalance();
    } catch (e: any) {
      this.error.set(e?.error?.error ?? 'No se pudo avisar a cocina. Probá de nuevo.');
    } finally {
      this.closingAll.set(false);
    }
  }
}
