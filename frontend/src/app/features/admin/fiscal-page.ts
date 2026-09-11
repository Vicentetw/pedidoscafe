import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { CurrentUserService } from '../../core/current-user';

interface Branch { id: number; name: string; }
interface FiscalConfig {
  cuit: string | null; point_of_sale_no: number | null;
  environment: 'HOMOLOGACION' | 'PRODUCCION'; default_doc_type: 'TICKET' | 'A' | 'B' | 'C';
}
interface TaxRate { id: number; code: string; name: string; rate: string; is_default: number; }
interface FiscalDoc {
  id: number; doc_type: string; pos_no: number; number: number; status: string;
  total_amount: string; order_id: number | null; session_id: number | null; issued_at: string;
}

// Comprobantes — Fase 8. Sin AFIP configurado emite ticket no fiscal
// numerado; si se carga un CUIT + tipo real sin certificado, cae solo a
// ticket (ver providers/afip.provider.js en el backend). /admin/fiscal.
@Component({
  selector: 'app-fiscal-page',
  imports: [FormsModule],
  template: `
    <h1>Comprobantes</h1>
    @if (error()) { <p style="color:var(--danger)">{{ error() }}</p> }
    @if (msg()) { <p style="color:var(--primary)">{{ msg() }}</p> }

    <div class="card">
      <label>Sucursal</label>
      <select [ngModel]="branchId()" (ngModelChange)="pickBranch($event)">
        @for (b of branches(); track b.id) { <option [ngValue]="b.id">{{ b.name }}</option> }
      </select>
    </div>

    <div class="cols">
      <div class="card">
        <h3>Configuración</h3>
        @if (cfg(); as c) {
          @if (c.cuit) {
            <p class="muted">CUIT {{ c.cuit }} · PV {{ c.point_of_sale_no }} · {{ c.environment }}</p>
          } @else {
            <p class="muted">Sin CUIT cargado: se emite ticket no fiscal (interno, sin CAE).</p>
          }
          @if (canManage()) {
            <div class="row">
              <input placeholder="CUIT (11 dígitos)" [(ngModel)]="fCuit" style="max-width:140px" />
              <input type="number" placeholder="punto de venta" [(ngModel)]="fPos" style="max-width:110px" />
            </div>
            <div class="row">
              <select [(ngModel)]="fEnv">
                <option value="HOMOLOGACION">Homologación</option>
                <option value="PRODUCCION">Producción</option>
              </select>
              <select [(ngModel)]="fDocType">
                <option value="TICKET">Ticket no fiscal</option>
                <option value="A">Factura A</option>
                <option value="B">Factura B</option>
                <option value="C">Factura C</option>
              </select>
              <button class="primary" (click)="saveConfig()">Guardar</button>
            </div>
            @if (fDocType !== 'TICKET') {
              <p class="muted small">Sin certificado AFIP real, la emisión de este tipo cae automáticamente a ticket no fiscal.</p>
            }
          }
        }

        <h3 style="margin-top:20px">Alícuotas</h3>
        <ul>
          @for (t of taxRates(); track t.id) {
            <li>{{ t.name }} — {{ t.rate }}% {{ t.is_default ? '(por defecto)' : '' }}</li>
          } @empty { <li class="muted">Sin alícuotas: el neto se informa igual al total (IVA 0).</li> }
        </ul>
        @if (canManage()) {
          <div class="row">
            <input placeholder="código" [(ngModel)]="tCode" style="max-width:90px" />
            <input placeholder="nombre" [(ngModel)]="tName" style="max-width:120px" />
            <input type="number" placeholder="%" [(ngModel)]="tRate" style="max-width:70px" />
            <label class="chk"><input type="checkbox" [(ngModel)]="tDefault" /> por defecto</label>
            <button (click)="createTaxRate()">Agregar</button>
          </div>
        }
      </div>

      <div class="card">
        <h3>Emitir</h3>
        @if (canIssue()) {
          <div class="row">
            <input type="number" placeholder="Nº de pedido" [(ngModel)]="issueOrderId" style="max-width:110px" />
            <button (click)="issueOrder()">Emitir por pedido</button>
          </div>
          <div class="row">
            <input type="number" placeholder="Nº de sesión de mesa" [(ngModel)]="issueSessionId" style="max-width:150px" />
            <button (click)="issueSession()">Emitir por mesa</button>
          </div>
          <p class="muted small">El pedido/mesa debe estar totalmente pagado. Emitir dos veces para el mismo pedido/mesa devuelve el mismo comprobante.</p>
        }

        <h3 style="margin-top:20px">Emitidos</h3>
        <table>
          <thead><tr><th>Tipo</th><th>Número</th><th>Total</th><th>Origen</th><th>Fecha</th></tr></thead>
          <tbody>
            @for (d of documents(); track d.id) {
              <tr>
                <td>{{ d.doc_type }}</td>
                <td>{{ d.pos_no }}-{{ d.number }}</td>
                <td>{{ d.total_amount }}</td>
                <td>{{ d.order_id ? 'pedido #' + d.order_id : 'mesa #' + d.session_id }}</td>
                <td>{{ d.issued_at }}</td>
              </tr>
            } @empty { <tr><td colspan="5" class="muted">Sin comprobantes emitidos.</td></tr> }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    .cols { display:grid; grid-template-columns: 1fr 1fr; gap:16px; }
    @media (max-width: 720px) { .cols { grid-template-columns: 1fr; } }
    ul { padding-left: 16px; }
    .row { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; align-items:center; }
    .chk { display:flex; align-items:center; gap:4px; }
    .small { font-size: 0.85em; }
    table { width:100%; border-collapse: collapse; margin-top:8px; }
    th, td { text-align:left; padding:4px 6px; border-bottom:1px solid var(--border); font-size:0.9em; }
  `],
})
export class FiscalPage implements OnInit {
  private readonly api = inject(Api);
  private readonly currentUser = inject(CurrentUserService);

  readonly branches = signal<Branch[]>([]);
  readonly branchId = signal<number | null>(null);
  readonly cfg = signal<FiscalConfig | null>(null);
  readonly taxRates = signal<TaxRate[]>([]);
  readonly documents = signal<FiscalDoc[]>([]);
  readonly error = signal('');
  readonly msg = signal('');

  fCuit = ''; fPos: number | null = null; fEnv: 'HOMOLOGACION' | 'PRODUCCION' = 'HOMOLOGACION'; fDocType: 'TICKET' | 'A' | 'B' | 'C' = 'TICKET';
  tCode = ''; tName = ''; tRate: number | null = null; tDefault = false;
  issueOrderId: number | null = null; issueSessionId: number | null = null;

  canManage() { return this.currentUser.hasPermission('settings:manage'); }
  canIssue() { return this.currentUser.hasPermission('payments:charge'); }

  ngOnInit() {
    this.api.get<{ data: Branch[] }>('/api/platform/branches').subscribe({
      next: (r) => { this.branches.set(r.data); if (r.data[0]) this.pickBranch(r.data[0].id); },
      error: (e) => this.fail(e, 'No se pudieron cargar las sucursales.'),
    });
    this.api.get<{ data: TaxRate[] }>('/api/fiscal/tax-rates').subscribe({ next: (r) => this.taxRates.set(r.data), error: () => {} });
  }
  private fail = (e: any, m: string) => this.error.set(e?.error?.error ?? m);

  pickBranch(id: number) {
    this.branchId.set(id);
    this.load();
  }
  private load() {
    this.api.get<FiscalConfig>(`/api/fiscal/config?branchId=${this.branchId()}`).subscribe({
      next: (c) => {
        this.cfg.set(c);
        this.fCuit = c.cuit ?? ''; this.fPos = c.point_of_sale_no; this.fEnv = c.environment; this.fDocType = c.default_doc_type;
      },
      error: (e) => this.fail(e, 'No se pudo cargar la configuración.'),
    });
    this.api.get<{ data: FiscalDoc[] }>(`/api/fiscal/documents?branchId=${this.branchId()}`).subscribe({ next: (r) => this.documents.set(r.data), error: () => {} });
  }
  saveConfig() {
    this.error.set(''); this.msg.set('');
    this.api.put(`/api/fiscal/config?branchId=${this.branchId()}`, {
      cuit: this.fCuit.trim() || undefined, pointOfSaleNo: this.fPos ?? undefined, environment: this.fEnv, defaultDocType: this.fDocType,
    }).subscribe({
      next: () => { this.msg.set('Configuración guardada.'); this.load(); },
      error: (e) => this.fail(e, 'No se pudo guardar la configuración.'),
    });
  }
  createTaxRate() {
    this.error.set('');
    this.api.post('/api/fiscal/tax-rates', { code: this.tCode.trim(), name: this.tName.trim(), rate: this.tRate, isDefault: this.tDefault }).subscribe({
      next: () => {
        this.tCode = this.tName = ''; this.tRate = null; this.tDefault = false;
        this.api.get<{ data: TaxRate[] }>('/api/fiscal/tax-rates').subscribe({ next: (r) => this.taxRates.set(r.data) });
      },
      error: (e) => this.fail(e, 'No se pudo crear la alícuota.'),
    });
  }
  issueOrder() {
    this.error.set(''); this.msg.set('');
    this.api.post(`/api/fiscal/orders/${this.issueOrderId}/issue`, {}).subscribe({
      next: (d: any) => { this.msg.set(`Comprobante emitido: ${d.doc_type} ${d.pos_no}-${d.number}.`); this.issueOrderId = null; this.load(); },
      error: (e) => this.fail(e, 'No se pudo emitir el comprobante.'),
    });
  }
  issueSession() {
    this.error.set(''); this.msg.set('');
    this.api.post(`/api/fiscal/sessions/${this.issueSessionId}/issue`, {}).subscribe({
      next: (d: any) => { this.msg.set(`Comprobante emitido: ${d.doc_type} ${d.pos_no}-${d.number}.`); this.issueSessionId = null; this.load(); },
      error: (e) => this.fail(e, 'No se pudo emitir el comprobante.'),
    });
  }
}
