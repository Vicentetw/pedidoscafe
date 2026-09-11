import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { CurrentUserService } from '../../core/current-user';

interface Branch { id: number; name: string; }
interface Register { id: number; code: string; name: string; }
interface OpenSession { id: number; register_id: number; register_code: string; register_name: string; opening_amount: string; opened_at: string; }
interface SessionDetail {
  id: number; status: string; opening_amount: string; currentBalance: string;
  closing_amount: string | null; expected_amount: string | null; difference: string | null;
  movements: { type: string; amount: string; reason: string | null; created_at: string }[];
}

// Apertura y cierre de cajas físicas — distinto de "Caja" (/admin/caja, que
// cobra mesas): acá se administra el arqueo. /admin/cajas.
@Component({
  selector: 'app-cash-page',
  imports: [FormsModule],
  template: `
    <h1>Cajas físicas</h1>
    @if (error()) { <p style="color:var(--danger)">{{ error() }}</p> }

    <div class="card">
      <label>Sucursal</label>
      <select [ngModel]="branchId()" (ngModelChange)="pickBranch($event)">
        @for (b of branches(); track b.id) { <option [ngValue]="b.id">{{ b.name }}</option> }
      </select>
    </div>

    <div class="cols">
      <div class="card">
        <h3>Cajas</h3>
        <ul>
          @for (r of registers(); track r.id) {
            <li>
              {{ r.name }} ({{ r.code }})
              @if (openSessionFor(r.id); as os) {
                <button class="link sel" (click)="selectOpen(os)">abierta desde {{ os.opened_at }}</button>
              } @else if (canOpen()) {
                <button (click)="open(r)">Abrir</button>
              }
            </li>
          } @empty { <li class="muted">Sin cajas creadas.</li> }
        </ul>
        @if (canManage()) {
          <div class="row">
            <input placeholder="código" [(ngModel)]="newCode" />
            <input placeholder="nombre" [(ngModel)]="newName" />
            <button class="primary" (click)="createRegister()">Nueva caja</button>
          </div>
        }
      </div>

      @if (detail(); as d) {
        <div class="card">
          <h3>Sesión de caja #{{ d.id }} — {{ d.status }}</h3>
          <p>Apertura: {{ d.opening_amount }} · Saldo actual: <strong>{{ d.currentBalance }}</strong></p>
          @if (d.status === 'CLOSED') {
            <p>Cierre: {{ d.closing_amount }} · Esperado: {{ d.expected_amount }} · Diferencia: {{ d.difference }}</p>
          }
          <ul>
            @for (m of d.movements; track $index) {
              <li>{{ m.created_at }} — {{ m.type }} {{ m.amount }} {{ m.reason ? '(' + m.reason + ')' : '' }}</li>
            } @empty { <li class="muted">Sin movimientos.</li> }
          </ul>

          @if (d.status === 'OPEN' && canMovement()) {
            <div class="row">
              <select [(ngModel)]="movType"><option value="DEPOSIT">Ingreso</option><option value="PAYOUT">Retiro</option><option value="ADJUST">Ajuste</option></select>
              <input type="number" placeholder="monto" [(ngModel)]="movAmount" style="max-width:110px" />
              <input placeholder="motivo" [(ngModel)]="movReason" />
              <button (click)="addMovement()">Registrar</button>
            </div>
          }
          @if (d.status === 'OPEN' && canClose()) {
            <div class="row">
              <input type="number" placeholder="monto contado" [(ngModel)]="closeAmount" style="max-width:130px" />
              <button class="primary" (click)="close()">Cerrar y arquear</button>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .cols { display:grid; grid-template-columns: 320px 1fr; gap:16px; }
    @media (max-width: 720px) { .cols { grid-template-columns: 1fr; } }
    ul { padding-left: 16px; }
    .row { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; align-items:center; }
    .row input, .row select { max-width: 140px; }
    button.link { border:none; background:none; color:var(--primary); }
    button.link.sel { text-decoration: underline; }
  `],
})
export class CashPage implements OnInit {
  private readonly api = inject(Api);
  private readonly currentUser = inject(CurrentUserService);

  readonly branches = signal<Branch[]>([]);
  readonly branchId = signal<number | null>(null);
  readonly registers = signal<Register[]>([]);
  readonly openSessions = signal<OpenSession[]>([]);
  readonly detail = signal<SessionDetail | null>(null);
  readonly error = signal('');

  newCode = ''; newName = '';
  movType: 'DEPOSIT' | 'PAYOUT' | 'ADJUST' = 'DEPOSIT';
  movAmount: number | null = null; movReason = '';
  closeAmount: number | null = null;

  canManage() { return this.currentUser.hasPermission('cash:manage'); }
  canOpen() { return this.currentUser.hasPermission('cash:open'); }
  canClose() { return this.currentUser.hasPermission('cash:close'); }
  canMovement() { return this.currentUser.hasPermission('cash:movement'); }

  openSessionFor(registerId: number) {
    return this.openSessions().find((s) => s.register_id === registerId) ?? null;
  }

  ngOnInit() {
    this.api.get<{ data: Branch[] }>('/api/platform/branches').subscribe({
      next: (r) => { this.branches.set(r.data); if (r.data[0]) this.pickBranch(r.data[0].id); },
      error: (e) => this.fail(e, 'No se pudieron cargar las sucursales.'),
    });
  }
  private fail = (e: any, m: string) => this.error.set(e?.error?.error ?? m);

  pickBranch(id: number) {
    this.branchId.set(id);
    this.detail.set(null);
    this.load();
  }
  private load() {
    this.api.get<{ data: Register[] }>(`/api/cash/registers?branchId=${this.branchId()}`).subscribe({ next: (r) => this.registers.set(r.data), error: (e) => this.fail(e, 'No se pudieron cargar las cajas.') });
    this.api.get<{ data: OpenSession[] }>(`/api/cash/sessions/open?branchId=${this.branchId()}`).subscribe({ next: (r) => this.openSessions.set(r.data), error: () => {} });
  }
  createRegister() {
    this.error.set('');
    this.api.post('/api/cash/registers?branchId=' + this.branchId(), { code: this.newCode.trim(), name: this.newName.trim() }).subscribe({
      next: () => { this.newCode = this.newName = ''; this.load(); },
      error: (e) => this.fail(e, 'No se pudo crear la caja.'),
    });
  }
  open(r: Register) {
    this.error.set('');
    const openingAmount = Number(prompt('Monto de apertura:', '0') ?? '0');
    this.api.post(`/api/cash/registers/${r.id}/open`, { openingAmount }).subscribe({
      next: () => this.load(),
      error: (e) => this.fail(e, 'No se pudo abrir la caja.'),
    });
  }
  selectOpen(s: OpenSession) {
    this.api.get<SessionDetail>(`/api/cash/sessions/${s.id}`).subscribe({ next: (d) => this.detail.set(d), error: (e) => this.fail(e, 'No se pudo cargar la sesión.') });
  }
  addMovement() {
    this.error.set('');
    this.api.post(`/api/cash/sessions/${this.detail()!.id}/movement`, { type: this.movType, amount: this.movAmount, reason: this.movReason }).subscribe({
      next: () => { this.movAmount = null; this.movReason = ''; this.selectOpen({ id: this.detail()!.id } as OpenSession); },
      error: (e) => this.fail(e, 'No se pudo registrar el movimiento.'),
    });
  }
  close() {
    this.error.set('');
    this.api.post(`/api/cash/sessions/${this.detail()!.id}/close`, { closingAmount: this.closeAmount }).subscribe({
      next: () => { this.closeAmount = null; this.load(); this.selectOpen({ id: this.detail()!.id } as OpenSession); },
      error: (e) => this.fail(e, 'No se pudo cerrar la caja.'),
    });
  }
}
