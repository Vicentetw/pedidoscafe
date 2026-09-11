import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `
    @if (auth.authChecked()) {
      <router-outlet />
    } @else {
      <div class="boot">Cargando…</div>
    }
  `,
  styles: [
    `.boot { display: grid; place-items: center; min-height: 100dvh; color: var(--muted); }`,
  ],
})
export class App {
  readonly auth = inject(AuthService);
}
