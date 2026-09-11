import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { CurrentUserService } from '../../core/current-user';

interface Customer {
  id: number; name: string; phone: string | null; email: string | null;
  birth_date: string | null; notes: string | null; first_seen_at: string; last_order_at: string | null;
}
interface Pref { key: string; value: string; updated_at: string; }
interface CustOrder { id: number; channel: string; status: string; payment_status: string; total: string; currency: string; created_at: string; }
interface LoyaltyAccount { points_balance: number; tier: { code: string; name: string } | null; }
interface LoyaltyTxn { id: number; type: string; points: number; reason: string | null; created_at: string; }

// Clientes — Fase 9. Buscar/ver es crm:view (lo tiene también mozo/cajero,
// para ubicar a alguien al tomar el pedido); crear/editar/preferencias es
// crm:manage (sólo dueño/admin). /admin/clientes.
@Component({
  selector: 'app-crm-page',
  imports: [FormsModule],
  template: `
    <h1>Clientes</h1>
    @if (error()) { <p style="color:var(--danger)">{{ error() }}</p> }
    @if (msg()) { <p style="color:var(--primary)">{{ msg() }}</p> }

    <div class="cols">
      <div class="card">
        <div class="row">
          <input placeholder="Buscar por nombre, teléfono o email…" [(ngModel)]="search" (ngModelChange)="onSearch()" />
        </div>
        <ul>
          @for (c of customers(); track c.id) {
            <li>
              <button class="link" [class.sel]="selected()?.id === c.id" (click)="select(c)">
                {{ c.name }} <span class="muted">{{ c.phone || c.email || '' }}</span>
              </button>
            </li>
          } @empty { <li class="muted">Sin clientes{{ search ? ' para esa búsqueda' : '' }}.</li> }
        </ul>

        @if (canManage()) {
          <h3 style="margin-top:16px">Nuevo cliente</h3>
          <div class="row"><input placeholder="nombre *" [(ngModel)]="nName" /></div>
          <div class="row">
            <input placeholder="teléfono" [(ngModel)]="nPhone" />
            <input placeholder="email" [(ngModel)]="nEmail" />
          </div>
          <button class="primary" (click)="create()">Crear</button>
        }
      </div>

      @if (selected(); as c) {
        <div class="card">
          <h3>{{ c.name }}</h3>
          <p class="muted">Cliente desde {{ c.first_seen_at }} · Última compra: {{ c.last_order_at || 'sin registrar' }}</p>

          @if (canManage()) {
            <div class="row">
              <input placeholder="teléfono" [(ngModel)]="ePhone" />
              <input placeholder="email" [(ngModel)]="eEmail" />
            </div>
            <div class="row"><input placeholder="notas" [(ngModel)]="eNotes" style="min-width:220px" /></div>
            <button (click)="save()">Guardar cambios</button>
          } @else {
            <p>{{ c.phone }} · {{ c.email }}</p>
            <p class="muted">{{ c.notes }}</p>
          }

          <h4 style="margin-top:16px">Preferencias</h4>
          <ul>
            @for (p of prefs(); track p.key) { <li>{{ p.key }}: {{ p.value }}</li> }
            @empty { <li class="muted">Sin preferencias cargadas.</li> }
          </ul>
          @if (canManage()) {
            <div class="row">
              <input placeholder="clave (ej. bebida)" [(ngModel)]="prefKey" style="max-width:120px" />
              <input placeholder="valor" [(ngModel)]="prefValue" style="max-width:160px" />
              <button (click)="savePref()">Guardar</button>
            </div>
          }

          @if (canSeeLoyalty()) {
            <h4 style="margin-top:16px">Fidelización</h4>
            @if (loyalty(); as l) {
              <p><strong>{{ l.points_balance }}</strong> puntos @if (l.tier) { · nivel {{ l.tier.name }} }</p>
            }
            @if (canAdjustLoyalty()) {
              <div class="row">
                <input type="number" placeholder="puntos" [(ngModel)]="loyPoints" style="max-width:90px" />
                <input placeholder="motivo" [(ngModel)]="loyReason" style="max-width:160px" />
                <button (click)="loyaltyEarn()">Sumar</button>
                <button (click)="loyaltyRedeem()">Canjear</button>
                <button (click)="loyaltyAdjust()">Ajustar (+/-)</button>
              </div>
            }
            <ul>
              @for (t of loyaltyTxns(); track t.id) { <li>{{ t.created_at }} — {{ t.type }} {{ t.points > 0 ? '+' : '' }}{{ t.points }} {{ t.reason ? '(' + t.reason + ')' : '' }}</li> }
              @empty { <li class="muted">Sin movimientos de puntos.</li> }
            </ul>
          }

          <h4 style="margin-top:16px">Historial de pedidos</h4>
          <table>
            <thead><tr><th>Canal</th><th>Estado</th><th>Pago</th><th>Total</th><th>Fecha</th></tr></thead>
            <tbody>
              @for (o of orders(); track o.id) {
                <tr><td>{{ o.channel }}</td><td>{{ o.status }}</td><td>{{ o.payment_status }}</td><td>{{ o.total }}</td><td>{{ o.created_at }}</td></tr>
              } @empty { <tr><td colspan="5" class="muted">Sin pedidos todavía.</td></tr> }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
  styles: [`
    .cols { display:grid; grid-template-columns: 320px 1fr; gap:16px; }
    @media (max-width: 720px) { .cols { grid-template-columns: 1fr; } }
    ul { padding-left: 16px; list-style: none; margin: 0; }
    .row { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; align-items:center; }
    button.link { border:none; background:none; color:var(--primary); text-align:left; padding:2px 0; }
    button.link.sel { font-weight:600; text-decoration: underline; }
    table { width:100%; border-collapse: collapse; margin-top:8px; }
    th, td { text-align:left; padding:4px 6px; border-bottom:1px solid var(--border); font-size:0.9em; }
  `],
})
export class CrmPage implements OnInit {
  private readonly api = inject(Api);
  private readonly currentUser = inject(CurrentUserService);

  readonly customers = signal<Customer[]>([]);
  readonly selected = signal<Customer | null>(null);
  readonly prefs = signal<Pref[]>([]);
  readonly orders = signal<CustOrder[]>([]);
  readonly loyalty = signal<LoyaltyAccount | null>(null);
  readonly loyaltyTxns = signal<LoyaltyTxn[]>([]);
  readonly error = signal('');
  readonly msg = signal('');

  search = '';
  nName = ''; nPhone = ''; nEmail = '';
  ePhone = ''; eEmail = ''; eNotes = '';
  prefKey = ''; prefValue = '';
  loyPoints: number | null = null; loyReason = '';

  canManage() { return this.currentUser.hasPermission('crm:manage'); }
  canSeeLoyalty() { return this.currentUser.hasPermission('loyalty:view'); }
  canAdjustLoyalty() { return this.currentUser.hasPermission('loyalty:adjust'); }

  ngOnInit() { this.onSearch(); }
  private fail = (e: any, m: string) => this.error.set(e?.error?.error ?? m);

  onSearch() {
    const q = this.search.trim() ? `?search=${encodeURIComponent(this.search.trim())}` : '';
    this.api.get<{ data: Customer[] }>(`/api/crm/customers${q}`).subscribe({ next: (r) => this.customers.set(r.data), error: (e) => this.fail(e, 'No se pudieron cargar los clientes.') });
  }
  select(c: Customer) {
    this.selected.set(c);
    this.ePhone = c.phone ?? ''; this.eEmail = c.email ?? ''; this.eNotes = c.notes ?? '';
    this.api.get<{ data: Pref[] }>(`/api/crm/customers/${c.id}/preferences`).subscribe({ next: (r) => this.prefs.set(r.data), error: () => {} });
    this.api.get<{ data: CustOrder[] }>(`/api/crm/customers/${c.id}/orders`).subscribe({ next: (r) => this.orders.set(r.data), error: () => {} });
    if (this.canSeeLoyalty()) this.loadLoyalty(c.id);
  }
  private loadLoyalty(customerId: number) {
    this.api.get<LoyaltyAccount>(`/api/loyalty/accounts/${customerId}`).subscribe({ next: (a) => this.loyalty.set(a), error: () => {} });
    this.api.get<{ data: LoyaltyTxn[] }>(`/api/loyalty/accounts/${customerId}/transactions`).subscribe({ next: (r) => this.loyaltyTxns.set(r.data), error: () => {} });
  }
  private loyaltyAction(path: string, fail: string) {
    this.error.set('');
    const id = this.selected()!.id;
    this.api.post<LoyaltyAccount>(`/api/loyalty/accounts/${id}/${path}`, { points: this.loyPoints, reason: this.loyReason.trim() }).subscribe({
      next: () => { this.loyPoints = null; this.loyReason = ''; this.loadLoyalty(id); },
      error: (e) => this.fail(e, fail),
    });
  }
  loyaltyEarn() { this.loyaltyAction('earn', 'No se pudo sumar puntos.'); }
  loyaltyRedeem() { this.loyaltyAction('redeem', 'No se pudo canjear (¿alcanza el saldo?).'); }
  loyaltyAdjust() { this.loyaltyAction('adjust', 'No se pudo ajustar.'); }
  create() {
    this.error.set(''); this.msg.set('');
    this.api.post<Customer>('/api/crm/customers', { name: this.nName.trim(), phone: this.nPhone.trim() || undefined, email: this.nEmail.trim() || undefined }).subscribe({
      next: (c) => { this.nName = this.nPhone = this.nEmail = ''; this.msg.set('Cliente creado.'); this.onSearch(); this.select(c); },
      error: (e) => this.fail(e, 'No se pudo crear el cliente.'),
    });
  }
  save() {
    this.error.set(''); this.msg.set('');
    const id = this.selected()!.id;
    this.api.put<Customer>(`/api/crm/customers/${id}`, { phone: this.ePhone.trim() || undefined, email: this.eEmail.trim() || undefined, notes: this.eNotes.trim() || undefined }).subscribe({
      next: (c) => { this.msg.set('Guardado.'); this.selected.set(c); this.onSearch(); },
      error: (e) => this.fail(e, 'No se pudo guardar.'),
    });
  }
  savePref() {
    this.error.set('');
    const id = this.selected()!.id;
    this.api.put<{ data: Pref[] }>(`/api/crm/customers/${id}/preferences/${encodeURIComponent(this.prefKey.trim())}`, { value: this.prefValue.trim() }).subscribe({
      next: (r) => { this.prefs.set(r.data); this.prefKey = this.prefValue = ''; },
      error: (e) => this.fail(e, 'No se pudo guardar la preferencia.'),
    });
  }
}
