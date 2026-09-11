import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { CurrentUserService } from '../../core/current-user';

interface Branch { id: number; name: string; }
interface Device { id: number; branch_id: number; code: string; kind: string; status: string; }

// Dispositivos — Fase 13 (buzzers de mostrador). Registrar/pausar es
// devices:manage; asignar a un pedido se hace desde el mostrador
// (order-entry), no acá. /admin/dispositivos.
@Component({
  selector: 'app-devices-page',
  imports: [FormsModule],
  template: `
    <h1>Dispositivos</h1>
    @if (error()) { <p style="color:var(--danger)">{{ error() }}</p> }
    @if (msg()) { <p style="color:var(--primary)">{{ msg() }}</p> }

    <div class="card">
      <div class="row">
        <select [(ngModel)]="branchId" (ngModelChange)="load()">
          @for (b of branches(); track b.id) { <option [ngValue]="b.id">{{ b.name }}</option> }
        </select>
      </div>
      <table>
        <thead><tr><th>Código</th><th>Tipo</th><th>Estado</th>@if (canManage()) { <th></th> }</tr></thead>
        <tbody>
          @for (d of devices(); track d.id) {
            <tr>
              <td>{{ d.code }}</td><td>{{ d.kind }}</td><td>{{ d.status }}</td>
              @if (canManage()) {
                <td>
                  @if (d.status !== 'OFFLINE') { <button (click)="setStatus(d, 'OFFLINE')">Pausar</button> }
                  @else { <button (click)="setStatus(d, 'AVAILABLE')">Reactivar</button> }
                </td>
              }
            </tr>
          } @empty { <tr><td colspan="4" class="muted">Sin dispositivos registrados.</td></tr> }
        </tbody>
      </table>
    </div>

    @if (canManage()) {
      <div class="card" style="margin-top:12px">
        <h3>Nuevo dispositivo</h3>
        <div class="row">
          <input placeholder="código (ej. B1)" [(ngModel)]="nCode" style="max-width:120px" />
          <select [(ngModel)]="nKind">
            <option value="BUZZER">Buzzer</option>
            <option value="PRINTER">Impresora</option>
            <option value="KDS_SCREEN">Pantalla de cocina</option>
          </select>
          <button class="primary" (click)="create()">Registrar</button>
        </div>
      </div>
    }
  `,
  styles: [`
    .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:10px; }
    table { width:100%; border-collapse: collapse; }
    th, td { text-align:left; padding:4px 6px; border-bottom:1px solid var(--border); font-size:0.9em; }
  `],
})
export class DevicesPage implements OnInit {
  private readonly api = inject(Api);
  private readonly currentUser = inject(CurrentUserService);

  readonly branches = signal<Branch[]>([]);
  readonly devices = signal<Device[]>([]);
  readonly error = signal('');
  readonly msg = signal('');

  branchId: number | null = null;
  nCode = ''; nKind: 'BUZZER' | 'PRINTER' | 'KDS_SCREEN' = 'BUZZER';

  canManage() { return this.currentUser.hasPermission('devices:manage'); }

  ngOnInit() {
    this.api.get<{ data: Branch[] }>('/api/platform/branches').subscribe({
      next: (r) => { this.branches.set(r.data); if (r.data[0]) { this.branchId = r.data[0].id; this.load(); } },
      error: (e) => this.fail(e, 'No se pudieron cargar las sucursales.'),
    });
  }
  private fail = (e: any, m: string) => this.error.set(e?.error?.error ?? m);

  load() {
    if (!this.branchId) return;
    this.api.get<{ data: Device[] }>(`/api/devices?branchId=${this.branchId}`).subscribe({ next: (r) => this.devices.set(r.data), error: (e) => this.fail(e, 'No se pudieron cargar los dispositivos.') });
  }
  create() {
    this.error.set(''); this.msg.set('');
    this.api.post('/api/devices', { branchId: this.branchId, code: this.nCode.trim(), kind: this.nKind }).subscribe({
      next: () => { this.nCode = ''; this.msg.set('Dispositivo registrado.'); this.load(); },
      error: (e) => this.fail(e, 'No se pudo registrar el dispositivo.'),
    });
  }
  setStatus(d: Device, status: string) {
    this.error.set('');
    this.api.put(`/api/devices/${d.id}/status`, { status }).subscribe({ next: () => this.load(), error: (e) => this.fail(e, 'No se pudo cambiar el estado.') });
  }
}
