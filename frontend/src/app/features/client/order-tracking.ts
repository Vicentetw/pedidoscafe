import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Api } from '../../core/api';
import { environment } from '../../../environments/environment';

interface Status { status: string; channel: string; branchName: string | null; deviceCode: string | null; readyAt: string | null; }

const LABELS: Record<string, string> = {
  DRAFT: 'Armando el pedido…', SUBMITTED: 'Recibido', VALIDATING_STOCK: 'Confirmando…',
  CONFIRMED: 'Confirmado', QUEUED: 'En cola', PREPARING: 'Preparando tu pedido',
  READY: '¡Listo para retirar!', DELIVERED: 'Entregado', COMPLETED: 'Completado',
  REJECTED_STOCK: 'Hubo un problema con el pedido', CANCELLED: 'Cancelado',
};
const STEPS = ['CONFIRMED', 'PREPARING', 'READY'];

// Seguimiento de un pedido de mostrador, sin login (Fase 13, prompt.txt
// §22: "aviso digital en teléfono"). El link (con el ULID del pedido) es la
// única credencial — mismo criterio que un código QR de mesa.
@Component({
  selector: 'app-order-tracking',
  template: `
    <div class="wrap">
      @if (error()) {
        <div class="card"><p class="err">{{ error() }}</p></div>
      } @else if (status(); as s) {
        <p class="eyebrow">{{ s.branchName || 'Tu pedido' }}</p>

        <div class="ring" [class.ready]="s.status === 'READY'">
          <span class="emoji">{{ s.status === 'READY' ? '🔔' : '🍽️' }}</span>
        </div>

        <h1 [class.ready-text]="s.status === 'READY'">{{ label(s.status) }}</h1>
        @if (s.deviceCode) { <p class="device">Dispositivo <strong>{{ s.deviceCode }}</strong></p> }

        <div class="steps">
          @for (step of steps; track step) {
            <div class="step" [class.done]="stepIndex(s.status) >= $index" [class.current]="stepIndex(s.status) === $index"></div>
          }
        </div>
      } @else {
        <p class="muted center">Cargando…</p>
      }
    </div>
  `,
  styles: [`
    :host { display:block; min-height:100dvh; background:var(--bg); color:var(--text); }
    .wrap { max-width: 420px; margin: 0 auto; padding: 12vh 1.25rem 2rem; text-align:center; }
    .center { padding-top: 30vh; }
    .eyebrow { margin: 0 0 var(--space-4); font-size: .8rem; color: var(--muted); text-transform: uppercase; letter-spacing: .07em; }

    .ring {
      width: 110px; height: 110px; margin: 0 auto var(--space-4);
      border-radius: 50%; display: grid; place-items: center;
      background: var(--surface-2); transition: background-color .3s ease;
    }
    .ring.ready { background: var(--success-soft); animation: pulse 1.6s ease-in-out infinite; }
    .emoji { font-size: 2.75rem; }
    @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }

    h1 { font-size: 1.4rem; margin: 0 0 var(--space-2); }
    h1.ready-text { color: var(--success); }
    .device { color: var(--muted); }
    .err { color: var(--danger); }

    .steps { display: flex; gap: 6px; justify-content: center; margin-top: var(--space-5); }
    .step { width: 40px; height: 5px; border-radius: var(--radius-pill); background: var(--border); }
    .step.done { background: var(--primary); }
    .step.current { background: var(--success); }
  `],
})
export class OrderTracking implements OnInit, OnDestroy {
  private readonly api = inject(Api);
  private readonly route = inject(ActivatedRoute);
  readonly status = signal<Status | null>(null);
  readonly error = signal('');
  readonly steps = STEPS;
  private es: EventSource | null = null;

  label(s: string) { return LABELS[s] ?? s; }
  stepIndex(s: string) {
    const i = STEPS.indexOf(s);
    if (i >= 0) return i;
    if (['QUEUED'].includes(s)) return 0;
    if (['DELIVERED', 'COMPLETED'].includes(s)) return STEPS.length - 1;
    return -1;
  }

  ngOnInit() {
    const publicId = this.route.snapshot.paramMap.get('publicId')!;
    this.load(publicId);
    this.es = new EventSource(`${environment.backendUrl}/api/public/orders/${publicId}/stream`);
    this.es.addEventListener('order_ready', () => this.load(publicId));
    this.es.onerror = () => { /* el navegador reintenta solo */ };
  }
  ngOnDestroy() { this.es?.close(); }

  private load(publicId: string) {
    this.api.get<Status>(`/api/public/orders/${publicId}/status`).subscribe({
      next: (s) => this.status.set(s),
      error: (e) => this.error.set(e?.error?.error ?? 'No se pudo cargar el pedido.'),
    });
  }
}
