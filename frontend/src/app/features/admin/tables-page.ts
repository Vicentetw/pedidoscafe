import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as QRCode from 'qrcode';
import { Api } from '../../core/api';
import { CurrentUserService } from '../../core/current-user';
import { SessionOrderDetail } from '../shared/session-order-detail';

interface Branch { id: number; code: string; name: string; }
interface Table {
  id: number; branch_id: number; code: string; name: string | null;
  seats: number; zone: string | null; status: string; current_session_id: number | null; qr_token: string | null;
}
interface OpenSession {
  id: number; public_id: string; table_id: number; table_code: string; status: string;
  order_mode: string; participant_count: number; opened_at: string;
}

const STATUS_BADGE: Record<string, string> = { FREE: 'badge-success', OCCUPIED: 'badge-warning', RESERVED: 'badge-info' };
const STATUS_LABEL: Record<string, string> = { FREE: 'Libre', OCCUPIED: 'Ocupada', RESERVED: 'Reservada' };

// Mesas, sus QR y las sesiones abiertas. El QR se genera en el navegador
// (misma URL que ya se podía copiar) — no hace falta nada del backend para
// esto, el token opaco es todo lo que necesita el código QR.
@Component({
  selector: 'app-tables-page',
  imports: [FormsModule, SessionOrderDetail],
  template: `
    <h1>Mesas</h1>
    @if (error()) { <p class="err">{{ error() }}</p> }

    <div class="card">
      <label>Sucursal</label>
      <select [ngModel]="branchId()" (ngModelChange)="pickBranch($event)">
        @for (b of branches(); track b.id) { <option [ngValue]="b.id">{{ b.name }}</option> }
      </select>
    </div>

    @if (branchId()) {
      <div class="card">
        <h3>Mesas de la sucursal</h3>
        <table>
          <thead><tr><th>Código</th><th>Nombre</th><th>Lugares</th><th>Estado</th><th>QR</th></tr></thead>
          <tbody>
            @for (t of tables(); track t.id) {
              <tr>
                <td>{{ t.code }}</td><td>{{ t.name || '—' }}</td><td>{{ t.seats }}</td>
                <td><span class="badge" [class]="badgeClass(t.status)">{{ statusLabel(t.status) }}</span></td>
                <td>
                  @if (t.qr_token) {
                    <button (click)="toggleQr(t)">{{ openQr() === t.id ? 'Ocultar QR' : 'Ver QR' }}</button>
                    <button class="link" (click)="copyLink(t)">Copiar link</button>
                    @if (canManage()) { <button class="link" (click)="rotate(t)">Rotar</button> }
                  }
                </td>
              </tr>
              @if (openQr() === t.id) {
                <tr class="qr-row">
                  <td colspan="5">
                    <div class="qr-box">
                      @if (qrImg(); as img) { <img [src]="img" [attr.alt]="'QR de ' + t.code" width="180" height="180" /> }
                      <div>
                        <p class="muted small">{{ linkFor(t) }}</p>
                        <button class="primary" (click)="print(t)">Imprimir para la mesa</button>
                      </div>
                    </div>
                  </td>
                </tr>
              }
            } @empty { <tr><td colspan="5" class="muted">Sin mesas.</td></tr> }
          </tbody>
        </table>
        @if (canManage()) {
          <div class="row">
            <input placeholder="código" [(ngModel)]="nc" />
            <input placeholder="nombre" [(ngModel)]="nn" />
            <input placeholder="lugares" type="number" [(ngModel)]="ns" style="max-width:100px" />
            <button class="primary" (click)="addTable()">Agregar mesa</button>
          </div>
        }
        @if (copied()) { <p class="muted small">Link copiado: {{ copied() }}</p> }
      </div>

      <div class="card">
        <h3>Mesas abiertas</h3>
        <ul class="sessions">
          @for (s of sessions(); track s.id) {
            <li>
              <button class="srow" [class.sel]="openSession() === s.id" (click)="toggleSession(s)">
                <span><strong>Mesa {{ s.table_code }}</strong> · {{ s.status }} · {{ s.order_mode }} · {{ s.participant_count }} persona(s)
                  @if (isStale(s)) { <span class="badge badge-warning">⏱ hace {{ openMinutes(s) }} min</span> }
                </span>
                <span class="chev">{{ openSession() === s.id ? '▲' : '▼' }}</span>
              </button>
              @if (openSession() === s.id) {
                <div class="detail">
                  <app-session-order-detail [sessionId]="s.id" (changed)="loadSessions()" />
                  <div class="row">
                    <button (click)="close(s)">Cerrar</button>
                    @if (canForceClose()) { <button class="danger" (click)="forceClose(s)">Cierre forzado</button> }
                  </div>
                </div>
              }
            </li>
          } @empty { <li class="muted">Ninguna mesa abierta.</li> }
        </ul>
        <p class="muted small hint">
          "Cerrar" exige que la mesa esté saldada (sin deuda). Si no lo está y hace
          falta liberarla igual (se fueron sin pagar, error de carga, etc.), usá
          "Cierre forzado" — pide un motivo y queda auditado.
        </p>
      </div>
    }
  `,
  styles: [`
    .card { margin-bottom: var(--space-4); }
    .row { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
    .row input { max-width: 160px; }
    .err { color: var(--danger); }
    .small { font-size: .85rem; }
    .actions { display: flex; gap: 6px; }
    .qr-row td { padding-top: 0; }
    .qr-box { display: flex; gap: var(--space-4); align-items: center; flex-wrap: wrap; padding: var(--space-3) 0; }
    .qr-box img { border-radius: var(--radius-sm); background: #fff; padding: 8px; }
    .hint { margin-top: var(--space-3); }
    .sessions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .srow {
      width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 8px;
      padding: 10px 12px; border-radius: var(--radius-sm); background: var(--surface-2); border: 1px solid transparent;
      text-align: left; font-size: .92rem;
    }
    .srow.sel { border-color: var(--primary); }
    .chev { color: var(--muted); font-size: .75rem; }
    .detail { padding: var(--space-3) 8px 4px; }
  `],
})
export class TablesPage implements OnInit, OnDestroy {
  private readonly api = inject(Api);
  private readonly currentUser = inject(CurrentUserService);

  readonly branches = signal<Branch[]>([]);
  readonly branchId = signal<number | null>(null);
  readonly tables = signal<Table[]>([]);
  readonly sessions = signal<OpenSession[]>([]);
  readonly error = signal('');
  readonly copied = signal('');
  readonly openQr = signal<number | null>(null);
  readonly qrImg = signal<string | null>(null);
  readonly openSession = signal<number | null>(null);
  private staleMinutes = 120;

  isStale(s: OpenSession) { return this.openMinutes(s) >= this.staleMinutes; }
  openMinutes(s: OpenSession) { return Math.floor((Date.now() - new Date(s.opened_at).getTime()) / 60000); }

  nc = ''; nn = ''; ns: number | null = null;

  canManage() { return this.currentUser.hasPermission('tables:manage'); }
  canForceClose() { return this.currentUser.hasPermission('tables:force_close'); }
  badgeClass(status: string) { return STATUS_BADGE[status] ?? 'badge'; }
  statusLabel(status: string) { return STATUS_LABEL[status] ?? status; }
  linkFor(t: Table) { return `${location.origin}/t/${t.qr_token}`; }

  private poll?: ReturnType<typeof setInterval>;

  ngOnInit() {
    this.api.get<{ data: Branch[] }>('/api/platform/branches').subscribe({
      next: (r) => { this.branches.set(r.data); if (r.data[0]) this.pickBranch(r.data[0].id); },
      error: (e) => this.fail(e, 'No se pudieron cargar las sucursales.'),
    });
    // Sin esto, una mesa nueva (alguien entró por QR) sólo se veía al
    // recargar la página a mano — mismo patrón de polling que ya usa Cocina.
    this.poll = setInterval(() => { if (this.branchId() && this.openSession() == null) { this.loadTables(); this.loadSessions(); } }, 8000);
  }
  ngOnDestroy() { clearInterval(this.poll); }
  private fail = (e: any, m: string) => this.error.set(e?.error?.error ?? m);

  pickBranch(id: number) {
    this.branchId.set(id);
    this.loadTables();
    this.loadSessions();
    this.api.get<{ data: Record<string, unknown> }>(`/api/platform/settings?branchId=${id}`).subscribe({
      next: (r) => { const v = r.data['orders.abandon_timeout_minutes']; this.staleMinutes = typeof v === 'number' ? v : 120; },
      error: () => { this.staleMinutes = 120; },
    });
  }
  loadTables() {
    this.api.get<{ data: Table[] }>(`/api/tables?branchId=${this.branchId()}`).subscribe({
      next: (r) => this.tables.set(r.data), error: (e) => this.fail(e, 'No se pudieron cargar las mesas.'),
    });
  }
  loadSessions() {
    this.api.get<{ data: OpenSession[] }>(`/api/tables/sessions/open?branchId=${this.branchId()}`).subscribe({
      next: (r) => this.sessions.set(r.data), error: (e) => this.fail(e, 'No se pudieron cargar las sesiones.'),
    });
  }
  toggleSession(s: OpenSession) {
    this.openSession.set(this.openSession() === s.id ? null : s.id);
  }
  addTable() {
    this.error.set('');
    this.api.post('/api/tables', { branchId: this.branchId(), code: this.nc.trim(), name: this.nn.trim() || undefined, seats: this.ns || undefined }).subscribe({
      next: () => { this.nc = this.nn = ''; this.ns = null; this.loadTables(); },
      error: (e) => this.fail(e, 'No se pudo crear la mesa.'),
    });
  }
  rotate(t: Table) {
    this.api.post(`/api/tables/${t.id}/qr/rotate`, {}).subscribe({ next: () => { this.loadTables(); if (this.openQr() === t.id) this.toggleQr(t); }, error: (e) => this.fail(e, 'No se pudo rotar el QR.') });
  }
  copyLink(t: Table) {
    const url = this.linkFor(t);
    navigator.clipboard?.writeText(url).catch(() => {});
    this.copied.set(url);
  }
  toggleQr(t: Table) {
    if (this.openQr() === t.id) { this.openQr.set(null); this.qrImg.set(null); return; }
    this.openQr.set(t.id);
    this.qrImg.set(null);
    QRCode.toDataURL(this.linkFor(t), { width: 360, margin: 1 }).then((img: string) => this.qrImg.set(img));
  }
  print(t: Table) {
    const img = this.qrImg();
    if (!img) return;
    const w = window.open('', '_blank', 'width=420,height=560');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>QR ${t.code}</title><style>
      body{font-family:system-ui,sans-serif;text-align:center;padding:32px;}
      h1{margin:0 0 4px;} p{color:#555;margin:0 0 24px;} img{width:320px;height:320px;}
    </style></head><body>
      <h1>${t.name || 'Mesa ' + t.code}</h1>
      <p>Escaneá para pedir</p>
      <img src="${img}" />
    </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }
  close(s: OpenSession) {
    this.api.post(`/api/tables/sessions/${s.id}/close`, {}).subscribe({
      next: () => { this.openSession.set(null); this.loadSessions(); this.loadTables(); },
      error: (e) => this.fail(e, e?.error?.error ?? 'No se pudo cerrar (¿saldo pendiente?).'),
    });
  }
  forceClose(s: OpenSession) {
    const reason = prompt('Motivo del cierre forzado:');
    if (reason == null) return;
    this.openSession.set(null);
    this.api.post(`/api/tables/sessions/${s.id}/force-close`, { reason }).subscribe({
      next: () => { this.loadSessions(); this.loadTables(); },
      error: (e) => this.fail(e, 'No se pudo forzar el cierre.'),
    });
  }
}
