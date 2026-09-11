import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TableSessionService } from '../../core/table-session';
import { OrderPanel } from './order-panel';

// Superficie del comensal DESDE LA MESA — /t/:token (el token del QR).
// 1) resuelve el QR  2) el comensal pone su nombre y se une  3) ve la
// sesión (quiénes están, modo de pedido) + el panel de pedido.
@Component({
  selector: 'app-table-session',
  imports: [FormsModule, RouterLink, OrderPanel],
  template: `
    <div class="wrap">
      @if (loading()) {
        <div class="center-msg"><p class="muted">Un momento…</p></div>
      } @else if (error()) {
        <div class="center-msg">
          <div class="card"><p>{{ error() }}</p></div>
        </div>
      } @else if (!joined()) {
        <div class="join-screen">
          <p class="eyebrow">Estás en</p>
          <h1>{{ place().table }}</h1>
          <p class="muted branch">{{ place().branch }}</p>

          <div class="card join-card">
            @if (!nameTaken()) {
              <label for="name">¿Cómo te llamás?</label>
              <input id="name" [(ngModel)]="name" placeholder="Tu nombre" (keyup.enter)="join()" autofocus />
              <button class="primary block" [disabled]="busy() || !name.trim()" (click)="join()">
                {{ busy() ? 'Entrando…' : 'Unirme a la mesa' }}
              </button>
              @if (othersPresent() > 0) {
                <p class="muted small">👋 Ya hay {{ othersPresent() }} persona(s) en esta mesa.</p>
              }
            } @else {
              <p>Ya hay alguien anotado como <strong>"{{ name }}"</strong> en esta mesa. ¿Sos vos?</p>
              <button class="primary block" [disabled]="busy()" (click)="join(true)">Sí, soy yo</button>
              <button class="block" [disabled]="busy()" (click)="nameTaken.set(false)">No, uso otro nombre</button>
            }
          </div>
        </div>
      } @else {
        <header class="top">
          <div>
            <h1>{{ place().table }}</h1>
            <span class="muted">{{ place().branch }}</span>
          </div>
        </header>

        <div class="card invite-card">
          <h3>Invitá al resto de la mesa</h3>
          <p class="muted small">
            Para que alguien pida y pague <strong>por su cuenta</strong>, tiene que entrar
            desde SU PROPIO celular con este mismo link (no alcanza con anotar el nombre acá abajo).
          </p>
          <button class="primary block" (click)="shareLink()">{{ shareCopied() ? '¡Link copiado!' : '📤 Compartir el link de la mesa' }}</button>
        </div>

        <div class="card">
          <h3>En la mesa</h3>
          <ul class="people">
            @for (p of state()?.participants; track p.id) {
              <li>
                <span class="avatar">{{ initial(p.name) }}</span>
                <span class="pname">{{ p.name }} @if (p.isYou) { <span class="badge badge-primary">vos</span> }</span>
                <button class="link small-link" [disabled]="removing() === p.id" (click)="removePerson(p)">quitar</button>
              </li>
            }
          </ul>
          <details class="note-add">
            <summary class="muted small">¿Alguien sin celular en la mesa? Anotalo acá</summary>
            <p class="muted small">
              Esto sólo anota el nombre para la cuenta — esa persona no va a poder pedir ni
              pagar sola; alguien más de la mesa tiene que hacerlo por ella.
            </p>
            <div class="row">
              <input [(ngModel)]="extraName" placeholder="Nombre" (keyup.enter)="addPerson()" />
              <button (click)="addPerson()" [disabled]="!extraName.trim()">Anotar</button>
            </div>
          </details>
          @if (actionError()) { <p class="err">{{ actionError() }}</p> }
        </div>

        @if (state()?.allowIndividualPayment) {
          <div class="card">
            <h3>Modo de pedido</h3>
            <div class="segmented">
              <button [class.active]="state()?.session?.orderMode === 'INDIVIDUAL'" (click)="setMode('INDIVIDUAL')">Cada uno lo suyo</button>
              <button [class.active]="state()?.session?.orderMode === 'GROUP'" (click)="setMode('GROUP')">Un pedido para la mesa</button>
            </div>
            @if (state()?.session?.orderMode === 'INDIVIDUAL') {
              <p class="muted small">Cada persona pide y paga SÓLO lo que agregó desde su propio celular (con este link).</p>
            } @else {
              <p class="muted small">Se arma un único pedido para toda la mesa; cualquiera puede pagar el total o dividirlo.</p>
            }
          </div>
        }

        <app-order-panel [tenantSlug]="tenantSlug()" [branchCode]="branchCode()" />

        <p class="muted small footer-link">
          <a class="link" routerLink="/m/{{ tenantSlug() }}/{{ branchCode() }}">Ver el menú completo</a>
        </p>
      }
    </div>
  `,
  styles: [`
    .wrap { max-width: 480px; margin: 0 auto; padding: var(--space-4); padding-bottom: calc(var(--space-6) + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: var(--space-4); min-height: 100dvh; }
    .center-msg { display: grid; place-items: center; flex: 1; }

    .join-screen { text-align: center; padding-top: 8vh; }
    .eyebrow { margin: 0; font-size: .85rem; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
    .join-screen h1 { margin: 2px 0 0; }
    .branch { margin: 0 0 var(--space-5); }
    .join-card { text-align: left; max-width: 360px; margin: 0 auto; }

    .top { display: flex; align-items: baseline; justify-content: space-between; }
    .top h1 { margin-bottom: 0; }

    .card { display: flex; flex-direction: column; gap: var(--space-2); }
    label { margin-top: 0; }

    .row { display: flex; gap: 8px; flex-wrap: wrap; }
    .row input { flex: 1; min-width: 140px; }
    .small { font-size: .85rem; margin: 0; }
    .block { width: 100%; }

    .invite-card { background: var(--primary-soft); border-color: transparent; }
    .invite-card h3 { color: var(--primary-hover); }

    .note-add { margin-top: var(--space-2); }
    .note-add summary { cursor: pointer; }
    .note-add p { margin: 8px 0; }

    .people { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
    .people li { display: flex; align-items: center; gap: 10px; }
    .pname { flex: 1; min-width: 0; }
    .avatar {
      display: inline-flex; align-items: center; justify-content: center;
      width: 30px; height: 30px; border-radius: 50%;
      background: var(--primary-soft); color: var(--primary-hover);
      font-weight: 700; font-size: .8rem; flex-shrink: 0;
    }
    .small-link { font-size: .78rem; flex-shrink: 0; }
    .err { color: var(--danger); font-size: .88rem; margin: 4px 0 0; }

    .segmented { display: flex; gap: 4px; background: var(--surface-2); padding: 4px; border-radius: var(--radius-sm); }
    .segmented button { flex: 1; border: none; background: transparent; box-shadow: none; font-size: .88rem; padding: 0.55rem 0.5rem; }
    .segmented button.active { background: var(--surface); box-shadow: var(--shadow-1); font-weight: 600; color: var(--primary-hover); }

    .footer-link { text-align: center; margin: 0; }
  `],
})
export class TableSession implements OnInit, OnDestroy {
  private readonly svc = inject(TableSessionService);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly joined = signal(false);
  readonly othersPresent = signal(0);
  readonly nameTaken = signal(false);
  readonly place = signal<{ table: string; branch: string }>({ table: '', branch: '' });
  readonly tenantSlug = signal('');
  readonly branchCode = signal('');
  readonly state = this.svc.state;
  readonly removing = signal<string | null>(null);
  // Distinto de `error` (que decide qué PANTALLA mostrar, antes de unirse):
  // este es un error de una acción DENTRO de la mesa ya unida — si
  // reusara `error`, el @if/@else if de arriba taparía toda la vista de
  // la mesa apenas fallara sacar a alguien.
  readonly actionError = signal('');
  readonly shareCopied = signal(false);

  name = '';
  extraName = '';
  private qrToken = '';
  private closeStream: () => void = () => {};

  initial(name: string) { return (name || '?').trim().charAt(0).toUpperCase(); }

  async ngOnInit() {
    this.qrToken = this.route.snapshot.paramMap.get('token') || '';
    try {
      const r = await this.svc.resolveQr(this.qrToken);
      this.place.set({ table: r.table.name || `Mesa ${r.table.code}`, branch: r.branch.name });
      this.tenantSlug.set(r.tenant.slug);
      this.branchCode.set(r.branch.code);
      // ¿ya hay un token guardado PARA ESTA MESA (de una visita anterior,
      // aunque haya cerrado la app)? Si sigue vigente, recupera el mismo
      // participante en vez de sumar uno nuevo.
      if (this.svc.loadStoredToken(this.qrToken)) {
        const s = await this.svc.refresh().catch(() => null);
        if (s) { this.joined.set(true); this.subscribe(); }
      }
    } catch (e: any) {
      this.error.set(e?.error?.error ?? 'Este código no es válido. Pedile al personal uno actualizado.');
    } finally {
      this.loading.set(false);
    }
  }

  ngOnDestroy() { this.closeStream(); }

  async join(claim = false) {
    this.busy.set(true);
    this.error.set('');
    try {
      const res = await this.svc.startSession(this.qrToken, this.name.trim(), undefined, claim);
      this.othersPresent.set(res.othersPresent);
      this.joined.set(true);
      this.subscribe();
    } catch (e: any) {
      if (e?.error?.code === 'NAME_TAKEN') {
        this.nameTaken.set(true);
      } else {
        this.error.set(e?.error?.error ?? 'No pudimos abrir la mesa. Probá de nuevo.');
      }
    } finally {
      this.busy.set(false);
    }
  }

  private subscribe() {
    this.closeStream = this.svc.openStream(() => this.svc.refresh());
  }

  async shareLink() {
    const url = `${location.origin}/t/${this.qrToken}`;
    const text = `Sumate a la mesa en ${this.place().branch}: ${url}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Sumate a la mesa', text, url }); return; } catch { /* el usuario canceló, seguimos con copiar */ }
    }
    try {
      await navigator.clipboard?.writeText(url);
      this.shareCopied.set(true);
      setTimeout(() => this.shareCopied.set(false), 2500);
    } catch { /* nada más que hacer sin permiso de portapapeles */ }
  }

  async addPerson() {
    const n = this.extraName.trim();
    if (!n) return;
    this.extraName = '';
    await this.svc.addParticipant(n).catch(() => {});
  }

  async removePerson(p: { id: string; name: string }) {
    if (!confirm(`¿Sacar a ${p.name} de la mesa?`)) return;
    this.actionError.set('');
    this.removing.set(p.id);
    try {
      await this.svc.removeParticipant(p.id);
    } catch (e: any) {
      this.actionError.set(e?.error?.error ?? 'No se pudo sacar de la mesa.');
    } finally {
      this.removing.set(null);
    }
  }

  async setMode(m: 'INDIVIDUAL' | 'GROUP') {
    await this.svc.setOrderMode(m).catch(() => {});
  }
}
