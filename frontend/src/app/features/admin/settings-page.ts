import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { CurrentUserService } from '../../core/current-user';

interface Branch { id: number; name: string; }

// Configuración por negocio (prompt.txt §70). `settings` es genérica
// (clave→valor JSON, por empresa o por sucursal — sucursal pisa empresa),
// pero acá le damos un control de verdad a la que el usuario pidió en la
// aceptación en vez de sólo mostrar el JSON crudo.
@Component({
  selector: 'app-settings-page',
  imports: [FormsModule],
  template: `
    <h1>Configuración</h1>
    @if (error()) { <p class="err">{{ error() }}</p> }
    @if (msg()) { <p class="ok">{{ msg() }}</p> }

    <div class="card">
      <label>Sucursal</label>
      <select [ngModel]="branchId()" (ngModelChange)="pickBranch($event)">
        <option [ngValue]="null">Toda la empresa (por defecto, salvo que la sucursal lo pise)</option>
        @for (b of branches(); track b.id) { <option [ngValue]="b.id">{{ b.name }}</option> }
      </select>
    </div>

    @if (loading()) {
      <p class="muted">Cargando…</p>
    } @else {
      <div class="card toggle-card">
        <div class="toggle-row">
          <div>
            <h3>Pago individual por mesa ("cada uno lo suyo")</h3>
            <p class="muted small">
              Oculto por defecto: la mesa sólo ofrece un pedido único para todos. Si lo
              activás, el comensal va a poder elegir que cada persona pida y pague su
              propia parte desde su celular.
            </p>
          </div>
          <label class="switch">
            <input type="checkbox" [ngModel]="allowIndividual()" (ngModelChange)="toggleIndividual($event)" [disabled]="saving()" />
            <span class="slider"></span>
          </label>
        </div>
        @if (branchId() === null) {
          <p class="muted small hint">Esto se está guardando a nivel EMPRESA — aplica a todas las sucursales que no tengan su propio valor.</p>
        } @else {
          <p class="muted small hint">Esto se está guardando sólo para esta sucursal.</p>
        }
      </div>

      <div class="card">
        <h3>Otros valores (avanzado)</h3>
        @if (entries().length) {
          <ul>
            @for (e of entries(); track e[0]) {
              <li><code>{{ e[0] }}</code> = {{ stringify(e[1]) }}</li>
            }
          </ul>
        } @else {
          <p class="muted small">Sin otros valores configurados — cada módulo usa su default.</p>
        }
      </div>
    }
  `,
  styles: [`
    .err { color: var(--danger); }
    .ok { color: var(--success); }
    .small { font-size: .85rem; }
    .toggle-card { display: flex; flex-direction: column; gap: var(--space-2); }
    .toggle-row { display: flex; justify-content: space-between; align-items: center; gap: var(--space-4); }
    .toggle-row h3 { margin-bottom: 2px; }
    .hint { margin: 0; }
    ul { padding-left: 18px; }

    .switch { position: relative; display: inline-block; width: 44px; height: 26px; flex-shrink: 0; }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider { position: absolute; inset: 0; background: var(--border-strong); border-radius: var(--radius-pill); transition: background-color .15s ease; cursor: pointer; }
    .slider::before { content: ''; position: absolute; width: 20px; height: 20px; left: 3px; top: 3px; background: var(--surface); border-radius: 50%; transition: transform .15s ease; box-shadow: var(--shadow-1); }
    .switch input:checked + .slider { background: var(--primary); }
    .switch input:checked + .slider::before { transform: translateX(18px); }
    .switch input:disabled + .slider { opacity: .6; cursor: not-allowed; }
  `],
})
export class SettingsPage implements OnInit {
  private readonly api = inject(Api);
  private readonly currentUser = inject(CurrentUserService);

  readonly branches = signal<Branch[]>([]);
  readonly branchId = signal<number | null>(null);
  readonly data = signal<Record<string, unknown>>({});
  readonly allowIndividual = signal(false);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly msg = signal('');

  private readonly KEY = 'orders.allow_individual_payment';

  entries() {
    return Object.entries(this.data()).filter(([k]) => k !== this.KEY);
  }
  stringify(v: unknown) { return JSON.stringify(v); }

  ngOnInit() {
    this.api.get<{ data: Branch[] }>('/api/platform/branches').subscribe({
      next: (r) => this.branches.set(r.data),
      error: () => {},
    });
    this.load();
  }

  pickBranch(id: number | null) {
    this.branchId.set(id);
    this.load();
  }

  private load() {
    this.loading.set(true);
    const q = this.branchId() != null ? `?branchId=${this.branchId()}` : '';
    this.api.get<{ data: Record<string, unknown> }>(`/api/platform/settings${q}`).subscribe({
      next: (r) => {
        this.data.set(r.data);
        this.allowIndividual.set(r.data[this.KEY] === true);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(e?.error?.error ?? 'No se pudo cargar la configuración.');
        this.loading.set(false);
      },
    });
  }

  toggleIndividual(value: boolean) {
    this.error.set(''); this.msg.set('');
    this.saving.set(true);
    const q = this.branchId() != null ? `?branchId=${this.branchId()}` : '';
    this.api.put(`/api/platform/settings/${this.KEY}${q}`, { value }).subscribe({
      next: () => { this.allowIndividual.set(value); this.msg.set('Guardado.'); this.saving.set(false); this.load(); },
      error: (e) => { this.error.set(e?.error?.error ?? 'No se pudo guardar.'); this.saving.set(false); },
    });
  }
}
