import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';

interface Branch { id: number; name: string; }
interface Summary {
  ordersCount: number; gross: string; discounts: string; net: string; tips: string; refunds: string;
  avgTicket: string; customers: number; repeatCustomers: number; repeatRate: number; avgPrepMinutes: number | null;
}
interface TopProduct { productId: number; name: string; qty: string; gross: string; }
interface DailyRow { date: string; ordersCount: number; net: string; avgTicket: string; }

// Analítica — Fase 12. Consultas directas (ver FASE12.md); GMV/Revenue/
// Ticket/Clientes/Repeat rate/Tiempo de preparación. Food cost/margen/LTV
// quedan afuera (sin método de costeo definido / sin datos de tráfico).
// /admin/analitica.
@Component({
  selector: 'app-analytics-page',
  imports: [FormsModule],
  template: `
    <h1>Analítica</h1>
    @if (error()) { <p style="color:var(--danger)">{{ error() }}</p> }

    <div class="card">
      <div class="row">
        <select [(ngModel)]="branchId" (ngModelChange)="load()">
          @for (b of branches(); track b.id) { <option [ngValue]="b.id">{{ b.name }}</option> }
        </select>
        <input type="date" [(ngModel)]="from" (ngModelChange)="load()" />
        <span class="muted">a</span>
        <input type="date" [(ngModel)]="to" (ngModelChange)="load()" />
      </div>
    </div>

    @if (summary(); as s) {
      <div class="kpis">
        <div class="kpi"><span class="n">{{ s.gross }}</span><span class="l">Bruto (GMV)</span></div>
        <div class="kpi"><span class="n">{{ s.net }}</span><span class="l">Neto</span></div>
        <div class="kpi"><span class="n">{{ s.discounts }}</span><span class="l">Descuentos</span></div>
        <div class="kpi"><span class="n">{{ s.refunds }}</span><span class="l">Devoluciones</span></div>
        <div class="kpi"><span class="n">{{ s.ordersCount }}</span><span class="l">Pedidos</span></div>
        <div class="kpi"><span class="n">{{ s.avgTicket }}</span><span class="l">Ticket promedio</span></div>
        <div class="kpi"><span class="n">{{ s.customers }}</span><span class="l">Clientes</span></div>
        <div class="kpi"><span class="n">{{ (s.repeatRate * 100).toFixed(0) }}%</span><span class="l">Repeat rate</span></div>
        <div class="kpi"><span class="n">{{ s.avgPrepMinutes ?? '—' }}</span><span class="l">Min. de preparación</span></div>
      </div>
    }

    <div class="cols">
      <div class="card">
        <h3>Top productos</h3>
        <table>
          <thead><tr><th>Producto</th><th>Cant.</th><th>Ingresos</th></tr></thead>
          <tbody>
            @for (p of topProducts(); track p.productId) { <tr><td>{{ p.name }}</td><td>{{ p.qty }}</td><td>{{ p.gross }}</td></tr> }
            @empty { <tr><td colspan="3" class="muted">Sin ventas en el período.</td></tr> }
          </tbody>
        </table>
      </div>
      <div class="card">
        <h3>Por día</h3>
        <table>
          <thead><tr><th>Fecha</th><th>Pedidos</th><th>Neto</th><th>Ticket prom.</th></tr></thead>
          <tbody>
            @for (d of daily(); track d.date) { <tr><td>{{ d.date }}</td><td>{{ d.ordersCount }}</td><td>{{ d.net }}</td><td>{{ d.avgTicket }}</td></tr> }
            @empty { <tr><td colspan="4" class="muted">Sin ventas en el período.</td></tr> }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
    .kpis { display:grid; grid-template-columns: repeat(auto-fill, minmax(130px,1fr)); gap:10px; margin: 14px 0; }
    .kpi { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:10px; display:flex; flex-direction:column; }
    .kpi .n { font-size:1.3em; font-weight:600; }
    .kpi .l { font-size:0.8em; color:var(--muted); }
    .cols { display:grid; grid-template-columns: 1fr 1fr; gap:16px; }
    @media (max-width: 720px) { .cols { grid-template-columns: 1fr; } }
    table { width:100%; border-collapse: collapse; }
    th, td { text-align:left; padding:4px 6px; border-bottom:1px solid var(--border); font-size:0.9em; }
  `],
})
export class AnalyticsPage implements OnInit {
  private readonly api = inject(Api);

  readonly branches = signal<Branch[]>([]);
  readonly summary = signal<Summary | null>(null);
  readonly topProducts = signal<TopProduct[]>([]);
  readonly daily = signal<DailyRow[]>([]);
  readonly error = signal('');

  branchId: number | null = null;
  to = new Date().toISOString().slice(0, 10);
  from = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);

  ngOnInit() {
    this.api.get<{ data: Branch[] }>('/api/platform/branches').subscribe({
      next: (r) => { this.branches.set(r.data); if (r.data[0]) { this.branchId = r.data[0].id; this.load(); } },
      error: (e) => this.fail(e, 'No se pudieron cargar las sucursales.'),
    });
  }
  private fail = (e: any, m: string) => this.error.set(e?.error?.error ?? m);

  load() {
    if (!this.branchId) return;
    this.error.set('');
    const q = `?branchId=${this.branchId}&from=${this.from}&to=${this.to}`;
    this.api.get<Summary>(`/api/analytics/sales-summary${q}`).subscribe({ next: (s) => this.summary.set(s), error: (e) => this.fail(e, 'No se pudo cargar el resumen.') });
    this.api.get<{ data: TopProduct[] }>(`/api/analytics/top-products${q}&limit=10`).subscribe({ next: (r) => this.topProducts.set(r.data), error: () => {} });
    this.api.get<{ data: DailyRow[] }>(`/api/analytics/daily${q}`).subscribe({ next: (r) => this.daily.set(r.data), error: () => {} });
  }
}
