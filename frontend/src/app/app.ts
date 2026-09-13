import { Component, inject, signal } from '@angular/core';
import { Router, RouterOutlet, NavigationStart, NavigationEnd, NavigationCancel, NavigationError } from '@angular/router';
import { AuthService } from './core/auth';
import { LoadingBarista } from './core/loading-barista/loading-barista';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, LoadingBarista],
  template: `
    @if (auth.authChecked() && !navigating()) {
      <router-outlet />
    } @else {
      <app-loading-barista />
    }
  `,
})
export class App {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  // El session-guard puede tardar varios segundos (backend "dormido" en
  // Render + reintentos) sin que el router muestre nada mientras tanto —
  // sin esto, esa espera era una pantalla en blanco. Se muestra sólo si
  // la navegación tarda un toque (150ms) para no hacer parpadear la
  // animación en las transiciones normales, instantáneas.
  readonly navigating = signal(false);
  private navTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationStart) {
        clearTimeout(this.navTimer);
        this.navTimer = setTimeout(() => this.navigating.set(true), 150);
      } else if (e instanceof NavigationEnd || e instanceof NavigationCancel || e instanceof NavigationError) {
        clearTimeout(this.navTimer);
        this.navigating.set(false);
      }
    });
  }
}
