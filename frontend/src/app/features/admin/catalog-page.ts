import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { CurrentUserService } from '../../core/current-user';

interface Menu { id: number; code: string; name: string; branch_id: number | null; }
interface Category { id: number; menu_id: number; code: string; name: string; }
interface Product {
  id: number; category_id: number; code: string; name: string;
  base_price: string; currency: string; is_active: boolean;
  track_stock: boolean; stock_qty: number | null; stock_min: number | null;
}

@Component({
  selector: 'app-catalog-page',
  imports: [FormsModule],
  template: `
    <h1>Menú</h1>
    @if (error()) { <p style="color:var(--danger)">{{ error() }}</p> }

    <div class="card">
      <h3>Menús</h3>
      <ul>
        @for (m of menus(); track m.id) {
          <li>
            <button class="link" [class.sel]="m.id === selMenu()?.id" (click)="pickMenu(m)">{{ m.name }}</button>
            <span class="muted">({{ m.code }}{{ m.branch_id ? ' · sucursal ' + m.branch_id : ' · global' }})</span>
          </li>
        } @empty { <li class="muted">Sin menús.</li> }
      </ul>
      @if (canManage()) {
        <div class="row">
          <input placeholder="código" [(ngModel)]="newMenuCode" />
          <input placeholder="nombre" [(ngModel)]="newMenuName" />
          <button class="primary" (click)="addMenu()">Agregar menú</button>
        </div>
      }
    </div>

    @if (selMenu()) {
      <div class="card">
        <h3>Categorías de "{{ selMenu()!.name }}"</h3>
        <ul>
          @for (c of categories(); track c.id) {
            <li>
              <button class="link" [class.sel]="c.id === selCat()?.id" (click)="pickCat(c)">{{ c.name }}</button>
              <span class="muted">({{ c.code }})</span>
            </li>
          } @empty { <li class="muted">Sin categorías.</li> }
        </ul>
        @if (canManage()) {
          <div class="row">
            <input placeholder="código" [(ngModel)]="newCatCode" />
            <input placeholder="nombre" [(ngModel)]="newCatName" />
            <button class="primary" (click)="addCat()">Agregar categoría</button>
          </div>
        }
      </div>
    }

    @if (selCat()) {
      <div class="card">
        <h3>Productos de "{{ selCat()!.name }}"</h3>
        <input class="search" placeholder="🔎 Buscar por nombre o código…" [(ngModel)]="search" />
        <table style="width:100%; border-collapse:collapse;">
          <thead><tr><th>Código</th><th>Nombre</th><th>Precio</th><th>Estado</th><th>Stock</th><th></th></tr></thead>
          <tbody>
            @for (p of filteredProducts(); track p.id) {
              <tr>
                <td>{{ p.code }}</td><td>{{ p.name }}</td><td>{{ p.currency }} {{ p.base_price }}</td>
                <td>
                  @if (!p.is_active) { <span class="badge">Oculto</span> }
                  @else if (p.track_stock && (p.stock_qty ?? 0) <= 0) { <span class="badge badge-danger">Agotado</span> }
                  @else if (p.track_stock && p.stock_min != null && (p.stock_qty ?? 0) <= p.stock_min) { <span class="badge badge-warning">Queda poco</span> }
                  @else { <span class="badge badge-success">Visible</span> }
                </td>
                <td>{{ p.track_stock ? (p.stock_qty ?? 0) : '—' }}</td>
                <td>
                  @if (canManage()) {
                    <button class="link" (click)="toggleEdit(p)">{{ editingId() === p.id ? 'cerrar' : 'editar' }}</button>
                  }
                </td>
              </tr>
              @if (editingId() === p.id) {
                <tr class="edit-row">
                  <td colspan="6">
                    <div class="edit-form">
                      <label><input type="checkbox" [(ngModel)]="edIsActive" /> Mostrar en el menú</label>
                      <label><input type="checkbox" [(ngModel)]="edTrackStock" /> Controlar stock</label>
                      @if (edTrackStock) {
                        <label>Cantidad disponible <input type="number" min="0" [(ngModel)]="edStockQty" style="width:80px" /></label>
                        <label>Avisar cuando quede <input type="number" min="0" [(ngModel)]="edStockMin" style="width:80px" /></label>
                      }
                      <button class="primary" [disabled]="savingEdit()" (click)="saveEdit(p)">Guardar</button>
                    </div>
                  </td>
                </tr>
              }
            } @empty { <tr><td colspan="6" class="muted">Sin productos{{ search ? ' que coincidan.' : '.' }}</td></tr> }
          </tbody>
        </table>
        @if (canManage()) {
          <div class="row">
            <input placeholder="código" [(ngModel)]="npCode" />
            <input placeholder="nombre" [(ngModel)]="npName" />
            <input placeholder="precio" type="number" [(ngModel)]="npPrice" style="max-width:120px" />
            <button class="primary" (click)="addProduct()">Agregar producto</button>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .card { margin-bottom: 16px; }
    .row { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
    .row input { max-width: 200px; }
    button.link { border:none; background:none; color:var(--primary); padding:2px 4px; }
    button.link.sel { font-weight:700; text-decoration:underline; }
    ul { padding-left: 18px; }
    .search { max-width: 320px; margin-bottom: 10px; }
    .edit-row td { padding: 10px; background: var(--surface-2); }
    .edit-form { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; font-size: .88rem; }
    .edit-form label { display: flex; align-items: center; gap: 6px; }
  `],
})
export class CatalogPage implements OnInit {
  private readonly api = inject(Api);
  private readonly currentUser = inject(CurrentUserService);

  readonly menus = signal<Menu[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly products = signal<Product[]>([]);
  readonly selMenu = signal<Menu | null>(null);
  readonly selCat = signal<Category | null>(null);
  readonly error = signal('');

  readonly productsOfCat = computed(() => {
    const c = this.selCat();
    return c ? this.products().filter((p) => p.category_id === c.id) : [];
  });
  search = '';
  readonly filteredProducts = computed(() => {
    const q = this.search.trim().toLowerCase();
    const list = this.productsOfCat();
    if (!q) return list;
    return list.filter((p) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q));
  });

  readonly editingId = signal<number | null>(null);
  readonly savingEdit = signal(false);
  edIsActive = true;
  edTrackStock = false;
  edStockQty: number | null = null;
  edStockMin: number | null = null;

  newMenuCode = ''; newMenuName = '';
  newCatCode = ''; newCatName = '';
  npCode = ''; npName = ''; npPrice: number | null = null;

  toggleEdit(p: Product) {
    if (this.editingId() === p.id) { this.editingId.set(null); return; }
    this.editingId.set(p.id);
    this.edIsActive = p.is_active;
    this.edTrackStock = p.track_stock;
    this.edStockQty = p.stock_qty;
    this.edStockMin = p.stock_min;
  }
  saveEdit(p: Product) {
    this.error.set('');
    this.savingEdit.set(true);
    const body: any = { isActive: this.edIsActive, trackStock: this.edTrackStock };
    if (this.edTrackStock) { body.stockQty = this.edStockQty ?? 0; body.stockMin = this.edStockMin; }
    this.api.patch(`/api/catalog/products/${p.id}`, body).subscribe({
      next: () => { this.savingEdit.set(false); this.editingId.set(null); this.pickCat(this.selCat()!); },
      error: (e) => { this.savingEdit.set(false); this.fail(e, 'No se pudo guardar.'); },
    });
  }

  canManage() { return this.currentUser.hasPermission('catalog:manage'); }

  ngOnInit() { this.loadMenus(); }

  private fail = (e: any, msg: string) => this.error.set(e?.error?.error ?? msg);

  loadMenus() {
    this.api.get<{ data: Menu[] }>('/api/catalog/menus').subscribe({
      next: (r) => { this.menus.set(r.data); if (r.data[0]) this.pickMenu(r.data[0]); },
      error: (e) => this.fail(e, 'No se pudieron cargar los menús.'),
    });
  }
  pickMenu(m: Menu) {
    this.selMenu.set(m); this.selCat.set(null); this.products.set([]);
    this.api.get<{ data: Category[] }>(`/api/catalog/menus/${m.id}/categories`).subscribe({
      next: (r) => { this.categories.set(r.data); if (r.data[0]) this.pickCat(r.data[0]); },
      error: (e) => this.fail(e, 'No se pudieron cargar las categorías.'),
    });
  }
  pickCat(c: Category) {
    this.selCat.set(c);
    this.api.get<{ data: Product[] }>(`/api/catalog/products?categoryId=${c.id}`).subscribe({
      next: (r) => this.products.set(r.data),
      error: (e) => this.fail(e, 'No se pudieron cargar los productos.'),
    });
  }
  addMenu() {
    this.error.set('');
    this.api.post<Menu>('/api/catalog/menus', { code: this.newMenuCode.trim(), name: this.newMenuName.trim() }).subscribe({
      next: () => { this.newMenuCode = this.newMenuName = ''; this.loadMenus(); },
      error: (e) => this.fail(e, 'No se pudo crear el menú.'),
    });
  }
  addCat() {
    this.error.set('');
    this.api.post<Category>('/api/catalog/categories', {
      menuId: this.selMenu()!.id, code: this.newCatCode.trim(), name: this.newCatName.trim(),
    }).subscribe({
      next: () => { this.newCatCode = this.newCatName = ''; this.pickMenu(this.selMenu()!); },
      error: (e) => this.fail(e, 'No se pudo crear la categoría.'),
    });
  }
  addProduct() {
    this.error.set('');
    this.api.post<Product>('/api/catalog/products', {
      categoryId: this.selCat()!.id, code: this.npCode.trim(), name: this.npName.trim(), basePrice: this.npPrice,
    }).subscribe({
      next: () => { this.npCode = this.npName = ''; this.npPrice = null; this.pickCat(this.selCat()!); },
      error: (e) => this.fail(e, 'No se pudo crear el producto.'),
    });
  }
}
