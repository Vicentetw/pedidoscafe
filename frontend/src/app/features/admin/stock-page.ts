import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { CurrentUserService } from '../../core/current-user';

interface Branch { id: number; name: string; }
interface Ingredient { id: number; code: string; name: string; unit: string; is_tracked: boolean; }
interface StockRow { ingredient_id: number; code: string; name: string; unit: string; qty_on_hand: string; qty_reserved: string; qty_available: string; reorder_point: string | null; }
interface Movement { ingredient_name: string; type: string; qty: string; reason: string | null; created_at: string; }

@Component({
  selector: 'app-stock-page',
  imports: [FormsModule],
  template: `
    <h1>Stock</h1>
    @if (error()) { <p style="color:var(--danger)">{{ error() }}</p> }

    <div class="card">
      <label>Sucursal</label>
      <select [ngModel]="branchId()" (ngModelChange)="pickBranch($event)">
        @for (b of branches(); track b.id) { <option [ngValue]="b.id">{{ b.name }}</option> }
      </select>
    </div>

    <div class="card">
      <h3>Existencias</h3>
      <table style="width:100%; border-collapse:collapse;">
        <thead><tr><th>Ingrediente</th><th>En stock</th><th>Reservado</th><th>Disponible</th><th>Punto de repo.</th></tr></thead>
        <tbody>
          @for (s of stock(); track s.ingredient_id) {
            <tr [class.low]="lowStock(s)">
              <td>{{ s.name }} <span class="muted">({{ s.unit }})</span></td>
              <td>{{ s.qty_on_hand }}</td><td>{{ s.qty_reserved }}</td>
              <td><strong>{{ s.qty_available }}</strong></td>
              <td>{{ s.reorder_point ?? '—' }}</td>
            </tr>
          } @empty { <tr><td colspan="5" class="muted">Sin ingredientes con stock.</td></tr> }
        </tbody>
      </table>

      @if (canAdjust()) {
        <div class="row">
          <select [(ngModel)]="adjCode">
            @for (i of ingredients(); track i.id) { <option [value]="i.code">{{ i.name }}</option> }
          </select>
          <input type="number" placeholder="nuevo total" [(ngModel)]="adjValue" style="max-width:120px" />
          <input placeholder="motivo" [(ngModel)]="adjReason" />
          <label class="chk"><input type="checkbox" [(ngModel)]="adjWaste" /> merma</label>
          <button class="primary" (click)="adjust()">Ajustar</button>
        </div>
      }
    </div>

    <div class="card">
      <h3>Ingredientes</h3>
      <ul class="muted">
        @for (i of ingredients(); track i.id) { <li>{{ i.code }} — {{ i.name }} ({{ i.unit }}){{ i.is_tracked ? '' : ' · sin seguimiento' }}</li> }
      </ul>
      @if (canManageRecipes()) {
        <div class="row">
          <input placeholder="código" [(ngModel)]="niCode" />
          <input placeholder="nombre" [(ngModel)]="niName" />
          <select [(ngModel)]="niUnit"><option>unit</option><option>g</option><option>kg</option><option>ml</option><option>l</option></select>
          <button class="primary" (click)="addIngredient()">Agregar</button>
        </div>
      }
    </div>

    <div class="card">
      <h3>Últimos movimientos</h3>
      <table style="width:100%; border-collapse:collapse;">
        <thead><tr><th>Fecha</th><th>Ingrediente</th><th>Tipo</th><th>Cant.</th><th>Motivo</th></tr></thead>
        <tbody>
          @for (m of movements(); track $index) {
            <tr><td>{{ m.created_at }}</td><td>{{ m.ingredient_name }}</td><td>{{ m.type }}</td><td>{{ m.qty }}</td><td>{{ m.reason ?? '—' }}</td></tr>
          } @empty { <tr><td colspan="5" class="muted">Sin movimientos.</td></tr> }
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    .card { margin-bottom: 16px; }
    .row { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; align-items:center; }
    .row input, .row select { max-width: 160px; }
    .chk { display:flex; gap:4px; align-items:center; width:auto; }
    .chk input { width:auto; }
    tr.low td { color: var(--danger); }
  `],
})
export class StockPage implements OnInit {
  private readonly api = inject(Api);
  private readonly currentUser = inject(CurrentUserService);

  readonly branches = signal<Branch[]>([]);
  readonly branchId = signal<number | null>(null);
  readonly ingredients = signal<Ingredient[]>([]);
  readonly stock = signal<StockRow[]>([]);
  readonly movements = signal<Movement[]>([]);
  readonly error = signal('');

  adjCode = ''; adjValue: number | null = null; adjReason = ''; adjWaste = false;
  niCode = ''; niName = ''; niUnit = 'unit';

  canAdjust() { return this.currentUser.hasPermission('inventory:adjust'); }
  canManageRecipes() { return this.currentUser.hasPermission('inventory:manage_recipes'); }

  lowStock(s: StockRow) {
    return s.reorder_point != null && Number(s.qty_available) <= Number(s.reorder_point);
  }

  ngOnInit() {
    this.api.get<{ data: Branch[] }>('/api/platform/branches').subscribe({
      next: (r) => { this.branches.set(r.data); if (r.data[0]) this.pickBranch(r.data[0].id); },
      error: (e) => this.fail(e, 'No se pudieron cargar las sucursales.'),
    });
    this.loadIngredients();
  }
  private fail = (e: any, m: string) => this.error.set(e?.error?.error ?? m);

  loadIngredients() {
    this.api.get<{ data: Ingredient[] }>('/api/inventory/ingredients').subscribe({ next: (r) => this.ingredients.set(r.data), error: () => {} });
  }
  pickBranch(id: number) {
    this.branchId.set(id);
    this.api.get<{ data: StockRow[] }>(`/api/inventory/stock?branchId=${id}`).subscribe({ next: (r) => this.stock.set(r.data), error: (e) => this.fail(e, 'No se pudo cargar el stock.') });
    this.api.get<{ data: Movement[] }>(`/api/inventory/movements?branchId=${id}`).subscribe({ next: (r) => this.movements.set(r.data), error: () => {} });
  }
  adjust() {
    this.error.set('');
    this.api.post(`/api/inventory/stock/adjust?branchId=${this.branchId()}`, {
      ingredientCode: this.adjCode, newOnHand: this.adjValue, reason: this.adjReason || undefined, waste: this.adjWaste,
    }).subscribe({
      next: () => { this.adjValue = null; this.adjReason = ''; this.adjWaste = false; this.pickBranch(this.branchId()!); },
      error: (e) => this.fail(e, 'No se pudo ajustar.'),
    });
  }
  addIngredient() {
    this.error.set('');
    this.api.post('/api/inventory/ingredients', { code: this.niCode.trim(), name: this.niName.trim(), unit: this.niUnit }).subscribe({
      next: () => { this.niCode = this.niName = ''; this.loadIngredients(); },
      error: (e) => this.fail(e, 'No se pudo crear el ingrediente.'),
    });
  }
}
