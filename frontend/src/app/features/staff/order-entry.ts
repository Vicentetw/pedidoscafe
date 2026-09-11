import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';

interface Branch { id: number; name: string; }
interface MenuProduct { code: string; name: string; price: string; currency: string; available: boolean; }

// Carga de pedidos de mostrador para el staff (channel COUNTER).
@Component({
  selector: 'app-order-entry',
  imports: [FormsModule],
  template: `
    <h1>Mostrador</h1>
    @if (error()) { <p style="color:var(--danger)">{{ error() }}</p> }

    <div class="bar">
      <select [ngModel]="branchId()" (ngModelChange)="pickBranch($event)">
        @for (b of branches(); track b.id) { <option [ngValue]="b.id">{{ b.name }}</option> }
      </select>
      @if (!order()) { <button class="primary" (click)="startOrder()">Nuevo pedido</button> }
    </div>

    @if (order(); as o) {
      <div class="cols">
        <div class="card">
          <h3>Menú</h3>
          @for (p of products(); track p.code) {
            <div class="mi">
              <span>{{ p.name }} <span class="muted">{{ p.currency }} {{ p.price }}</span></span>
              <button (click)="add(p.code)" [disabled]="!p.available || busy()">Agregar</button>
            </div>
          } @empty { <p class="muted">Sin productos en esta sucursal.</p> }
        </div>
        <div class="card">
          <h3>Pedido #{{ o.public_id.slice(-5) }} — {{ o.status }}</h3>
          <ul>
            @for (it of o.items; track it.id) {
              <li>{{ it.qty }}× {{ it.name_snapshot }} — {{ o.currency }} {{ it.line_total }}
                @if (o.status === 'DRAFT') { <button class="x" (click)="remove(it.id)">x</button> }
              </li>
            } @empty { <li class="muted">Vacío.</li> }
          </ul>
          @if (+o.discount_total > 0) {
            <p class="muted">Subtotal: {{ o.currency }} {{ o.subtotal }} · Descuento: -{{ o.currency }} {{ o.discount_total }}</p>
          }
          <p><strong>Total: {{ o.currency }} {{ o.total }}</strong></p>
          @if (o.payment_status === 'UNPAID') {
            <div class="row">
              <input placeholder="código de promo" [(ngModel)]="promoCode" style="max-width:140px" />
              <button (click)="applyPromo()" [disabled]="!promoCode.trim() || busy()">Aplicar</button>
            </div>
          }
          @if (assignedDevice(); as dc) {
            <p>Dispositivo entregado: <strong>{{ dc }}</strong> <button class="link" (click)="releaseDevice()">liberar</button></p>
          } @else {
            <div class="row">
              <input placeholder="código de buzzer" [(ngModel)]="deviceCode" style="max-width:120px" />
              <button (click)="assignDevice()" [disabled]="!deviceCode.trim() || busy()">Entregar dispositivo</button>
            </div>
          }
          @if (o.status === 'DRAFT') {
            <button class="primary" [disabled]="!o.items.length || busy()" (click)="submit()">Confirmar y enviar a cocina</button>
          } @else {
            <button (click)="order.set(null)">Nuevo pedido</button>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .bar { display: flex; gap: 8px; margin-bottom: 12px; }
    .bar select { width: auto; }
    .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 720px) { .cols { grid-template-columns: 1fr; } }
    .mi { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border); }
    ul { padding-left: 16px; }
    .x { border: none; background: none; color: var(--danger); }
    .row { display:flex; gap:8px; margin: 10px 0; align-items:center; }
    button.link { border:none; background:none; color:var(--primary); text-decoration:underline; padding:0; }
  `],
})
export class OrderEntry implements OnInit {
  private readonly api = inject(Api);

  readonly branches = signal<Branch[]>([]);
  readonly branchId = signal<number | null>(null);
  readonly products = signal<MenuProduct[]>([]);
  readonly order = signal<any>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  private tenantSlug = '';
  promoCode = '';
  deviceCode = '';
  readonly assignedDevice = signal<string | null>(null);

  ngOnInit() {
    this.api.get<{ tenantSlug: string | null }>('/api/platform/users/me').subscribe((me) => {
      this.tenantSlug = me.tenantSlug ?? '';
      this.loadMenu();
    });
    this.api.get<{ data: (Branch & { code: string })[] }>('/api/platform/branches').subscribe({
      next: (r) => { this.branches.set(r.data); if (r.data[0]) this.pickBranch(r.data[0].id); },
      error: (e) => this.error.set(e?.error?.error ?? 'No se pudieron cargar las sucursales.'),
    });
  }

  private branchCode = '';
  pickBranch(id: number) {
    this.branchId.set(id);
    const b = this.branches().find((x) => x.id === id) as any;
    this.branchCode = b?.code ?? '';
    this.loadMenu();
  }

  private loadMenu() {
    if (!this.tenantSlug || !this.branchCode) { this.products.set([]); return; }
    this.api.get<any>(`/api/public/menu/${this.tenantSlug}/${this.branchCode}`).subscribe({
      next: (m) => this.products.set((m.menus ?? []).flatMap((mm: any) => mm.categories).flatMap((c: any) => c.products)),
      error: () => this.products.set([]),
    });
  }

  startOrder() {
    this.assignedDevice.set(null);
    this.api.post<any>('/api/orders', { branchId: this.branchId(), channel: 'COUNTER' }).subscribe({
      next: (o) => this.order.set(o),
      error: (e) => this.error.set(e?.error?.error ?? 'No se pudo crear el pedido.'),
    });
  }
  add(productCode: string) {
    this.busy.set(true);
    this.api.post<any>(`/api/orders/${this.order().id}/items`, { productCode, qty: 1 }).subscribe({
      next: (o) => { this.order.set(o); this.busy.set(false); },
      error: (e) => { this.error.set(e?.error?.error ?? 'No se pudo agregar.'); this.busy.set(false); },
    });
  }
  remove(itemId: number) {
    this.api.delete(`/api/orders/${this.order().id}/items/${itemId}`).subscribe({ next: () => this.reload(), error: () => {} });
  }
  private reload() {
    this.api.get<any>(`/api/orders/${this.order().id}`).subscribe((o) => this.order.set(o));
  }
  applyPromo() {
    this.error.set('');
    this.api.post<any>(`/api/orders/${this.order().id}/promotions/${encodeURIComponent(this.promoCode.trim())}/apply`, {}).subscribe({
      next: (o) => { this.order.set(o); this.promoCode = ''; },
      error: (e) => this.error.set(e?.error?.error ?? 'No se pudo aplicar ese código.'),
    });
  }
  assignDevice() {
    this.error.set('');
    this.api.post<{ deviceCode: string }>(`/api/orders/${this.order().id}/device`, { deviceCode: this.deviceCode.trim() }).subscribe({
      next: (r) => { this.assignedDevice.set(r.deviceCode); this.deviceCode = ''; },
      error: (e) => this.error.set(e?.error?.error ?? 'No se pudo entregar ese dispositivo.'),
    });
  }
  releaseDevice() {
    this.error.set('');
    this.api.delete(`/api/orders/${this.order().id}/device`).subscribe({
      next: () => this.assignedDevice.set(null),
      error: (e) => this.error.set(e?.error?.error ?? 'No se pudo liberar el dispositivo.'),
    });
  }
  submit() {
    this.busy.set(true);
    this.api.post<any>(`/api/orders/${this.order().id}/submit`, {}).subscribe({
      next: (o) => { this.order.set(o); this.busy.set(false); },
      error: (e) => { this.error.set(e?.error?.error ?? 'No se pudo confirmar.'); this.busy.set(false); },
    });
  }
}
