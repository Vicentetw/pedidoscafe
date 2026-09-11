import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { CurrentUserService } from '../../core/current-user';

interface Promotion {
  id: number; code: string; name: string; type: string; value: string | null;
  priority: number; stackable: number; status: string;
  rules?: { id: number; condition_type: string; operator: string; value: any }[];
}

// Promociones — Fase 11. Sólo PERCENT/FIXED tienen motor de cálculo (ver
// FASE11.md); el resto del enum existe en la base pero el alta se rechaza.
// Ver/crear es promotions:manage — el resto del staff las aplica por código
// desde el pedido (mostrador/mesa), sin necesitar ver este catálogo.
// /admin/promociones.
@Component({
  selector: 'app-promotions-page',
  imports: [FormsModule],
  template: `
    <h1>Promociones</h1>
    @if (error()) { <p style="color:var(--danger)">{{ error() }}</p> }
    @if (msg()) { <p style="color:var(--primary)">{{ msg() }}</p> }

    <div class="cols">
      <div class="card">
        <h3>Activas / pausadas</h3>
        <ul>
          @for (p of promotions(); track p.id) {
            <li>
              <button class="link" [class.sel]="selected()?.id === p.id" (click)="select(p)">
                {{ p.code }} — {{ p.name }} <span class="muted">({{ p.status }})</span>
              </button>
            </li>
          } @empty { <li class="muted">Sin promociones creadas.</li> }
        </ul>

        @if (canManage()) {
          <h3 style="margin-top:16px">Nueva promoción</h3>
          <div class="row"><input placeholder="código" [(ngModel)]="nCode" style="max-width:120px" /></div>
          <div class="row"><input placeholder="nombre" [(ngModel)]="nName" /></div>
          <div class="row">
            <select [(ngModel)]="nType">
              <option value="PERCENT">% descuento</option>
              <option value="FIXED">$ fijo</option>
            </select>
            <input type="number" placeholder="valor" [(ngModel)]="nValue" style="max-width:90px" />
          </div>
          <div class="row">
            <label class="chk"><input type="checkbox" [(ngModel)]="nStackable" /> combinable con otras</label>
          </div>
          <button class="primary" (click)="create()">Crear</button>
        }
      </div>

      @if (selected(); as p) {
        <div class="card">
          <h3>{{ p.code }} — {{ p.name }}</h3>
          <p class="muted">{{ p.type === 'PERCENT' ? p.value + '%' : '$' + p.value }} · {{ p.stackable ? 'combinable' : 'no combinable' }} · prioridad {{ p.priority }}</p>

          @if (canManage()) {
            <div class="row">
              <button (click)="toggleStatus()">{{ p.status === 'ACTIVE' ? 'Pausar' : 'Activar' }}</button>
            </div>
          }

          <h4 style="margin-top:16px">Condiciones (todas deben cumplirse)</h4>
          <ul>
            @for (r of p.rules; track r.id) { <li>{{ r.condition_type }}: {{ ruleSummary(r) }}</li> }
            @empty { <li class="muted">Sin condiciones — aplica siempre que se use el código.</li> }
          </ul>
          @if (canManage()) {
            <div class="row">
              <select [(ngModel)]="rCondition">
                <option value="MIN_AMOUNT">Monto mínimo</option>
                <option value="MIN_QTY">Cantidad mínima</option>
                <option value="BRANCH">Sucursal</option>
                <option value="CUSTOMER_TIER">Nivel de fidelización</option>
                <option value="DAY">Día de la semana</option>
                <option value="TIME">Franja horaria</option>
              </select>
              <input placeholder="valor (ver ayuda abajo)" [(ngModel)]="rValue" style="min-width:160px" />
              <button (click)="addRule()">Agregar</button>
            </div>
            <p class="muted small">
              Monto mínimo: <code>1500</code> · Cantidad mínima: <code>3</code> · Sucursal: <code>5</code> (su ID) ·
              Nivel: <code>oro</code> (código del nivel) · Día: <code>0,1,2,3,4</code> (0=lunes) · Horario: <code>18:00-20:00</code>
            </p>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .cols { display:grid; grid-template-columns: 320px 1fr; gap:16px; }
    @media (max-width: 720px) { .cols { grid-template-columns: 1fr; } }
    ul { padding-left: 16px; list-style: none; margin: 0; }
    .row { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; align-items:center; }
    .chk { display:flex; align-items:center; gap:4px; }
    .small { font-size: 0.85em; }
    button.link { border:none; background:none; color:var(--primary); text-align:left; padding:2px 0; }
    button.link.sel { font-weight:600; text-decoration: underline; }
  `],
})
export class PromotionsPage implements OnInit {
  private readonly api = inject(Api);
  private readonly currentUser = inject(CurrentUserService);

  readonly promotions = signal<Promotion[]>([]);
  readonly selected = signal<Promotion | null>(null);
  readonly error = signal('');
  readonly msg = signal('');

  nCode = ''; nName = ''; nType: 'PERCENT' | 'FIXED' = 'PERCENT'; nValue: number | null = null; nStackable = false;
  rCondition = 'MIN_AMOUNT'; rValue = '';

  canManage() { return this.currentUser.hasPermission('promotions:manage'); }

  ngOnInit() { this.load(); }
  private fail = (e: any, m: string) => this.error.set(e?.error?.error ?? m);

  private load() {
    this.api.get<{ data: Promotion[] }>('/api/promotions').subscribe({ next: (r) => this.promotions.set(r.data), error: (e) => this.fail(e, 'No se pudieron cargar las promociones.') });
  }
  select(p: Promotion) {
    this.api.get<Promotion>(`/api/promotions/${p.id}`).subscribe({ next: (full) => this.selected.set(full), error: (e) => this.fail(e, 'No se pudo cargar la promoción.') });
  }
  create() {
    this.error.set(''); this.msg.set('');
    this.api.post<Promotion>('/api/promotions', { code: this.nCode.trim(), name: this.nName.trim(), type: this.nType, value: this.nValue, stackable: this.nStackable }).subscribe({
      next: (p) => { this.nCode = this.nName = ''; this.nValue = null; this.nStackable = false; this.msg.set('Promoción creada.'); this.load(); this.select(p); },
      error: (e) => this.fail(e, 'No se pudo crear la promoción.'),
    });
  }
  toggleStatus() {
    this.error.set('');
    const p = this.selected()!;
    const status = p.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    this.api.put<Promotion>(`/api/promotions/${p.id}/status`, { status }).subscribe({
      next: (full) => { this.selected.set(full); this.load(); },
      error: (e) => this.fail(e, 'No se pudo cambiar el estado.'),
    });
  }
  addRule() {
    this.error.set('');
    const p = this.selected()!;
    let value: any;
    const raw = this.rValue.trim();
    switch (this.rCondition) {
      case 'MIN_AMOUNT': value = { amount: raw }; break;
      case 'MIN_QTY': value = { qty: Number(raw) }; break;
      case 'BRANCH': value = { branchId: Number(raw) }; break;
      case 'CUSTOMER_TIER': value = { tierCode: raw }; break;
      case 'DAY': value = { days: raw.split(',').map((x) => Number(x.trim())) }; break;
      case 'TIME': { const [from, to] = raw.split('-'); value = { from: from?.trim(), to: to?.trim() }; break; }
    }
    this.api.post<Promotion>(`/api/promotions/${p.id}/rules`, { conditionType: this.rCondition, value }).subscribe({
      next: (full) => { this.selected.set(full); this.rValue = ''; },
      error: (e) => this.fail(e, 'No se pudo agregar la condición (revisá el formato del valor).'),
    });
  }
  ruleSummary(r: { condition_type: string; value: any }) {
    const v = r.value;
    switch (r.condition_type) {
      case 'MIN_AMOUNT': return `desde $${v.amount}`;
      case 'MIN_QTY': return `${v.qty}+ unidades`;
      case 'BRANCH': return `sucursal #${v.branchId ?? (v.branchIds || []).join(',')}`;
      case 'CUSTOMER_TIER': return `nivel ${v.tierCode ?? (v.tierCodes || []).join(',')}`;
      case 'DAY': return `días ${(v.days || []).join(',')}`;
      case 'TIME': return `${v.from}–${v.to}`;
      default: return JSON.stringify(v);
    }
  }
}
