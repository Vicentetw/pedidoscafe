import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../auth';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  template: `
    <div class="wrap">
      <div class="card">
        <p class="eyebrow">Bienvenido a</p>
        <h1>Restia Pedidos</h1>
        <p class="muted intro">Ingresá con tu cuenta para continuar</p>

        <label for="email">Email</label>
        <input id="email" type="email" [(ngModel)]="email" autocomplete="username" />
        <label for="password">Contraseña</label>
        <input id="password" type="password" [(ngModel)]="password" autocomplete="current-password" (keyup.enter)="signIn()" />

        @if (error()) { <p class="err">{{ error() }}</p> }

        <button class="primary block" [disabled]="busy()" (click)="signIn()">
          {{ busy() ? 'Ingresando…' : 'Ingresar' }}
        </button>
        <div class="divider"><span>o</span></div>
        <button class="block" [disabled]="busy()" (click)="google()">Continuar con Google</button>
      </div>
    </div>
  `,
  styles: [
    `
      .wrap { display: grid; place-items: center; min-height: 100dvh; padding: 16px; }
      .card { width: min(380px, 100%); display: flex; flex-direction: column; gap: 4px; }
      .eyebrow { margin: 0; font-size: .8rem; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
      h1 { margin: 2px 0 0; color: var(--primary); }
      .intro { margin: 0 0 var(--space-3); }
      .block { width: 100%; margin-top: 10px; }
      .divider { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: .8rem; margin: 12px 0 2px; }
      .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--border); }
      .err { color: var(--danger); font-size: 0.88rem; margin: 4px 0 0; }
    `,
  ],
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  email = '';
  password = '';
  readonly busy = signal(false);
  readonly error = signal('');

  constructor() {
    // Si ya hay sesión, no tiene sentido quedarse acá.
    this.auth.ready().then((u) => {
      if (u) this.router.navigateByUrl('/');
    });
  }

  async signIn() {
    this.error.set('');
    this.busy.set(true);
    try {
      await this.auth.signIn(this.email.trim(), this.password);
    } catch {
      this.error.set('Email o contraseña incorrectos.');
      this.busy.set(false);
    }
  }

  async google() {
    this.error.set('');
    this.busy.set(true);
    try {
      await this.auth.signInWithGoogle();
    } catch {
      this.error.set('No se pudo iniciar sesión con Google.');
      this.busy.set(false);
    }
  }
}
