import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../auth';
import { CurrentUserService } from '../current-user';

@Component({
  selector: 'app-access-denied',
  imports: [RouterLink],
  template: `
    <div class="wrap">
      <div class="card">
        <h1>No tenés acceso</h1>
        @if (required) {
          <p class="muted">Te falta el permiso <code>{{ required }}</code>.</p>
        } @else if (!profile()) {
          <p class="muted">
            Tu cuenta de Firebase no está habilitada en el sistema
            @if (error()) { — {{ error() }} }
          </p>
        }
        <div class="row">
          <button (click)="retry()">Reintentar</button>
          <a routerLink="/">Volver al inicio</a>
          <button (click)="signOut()">Salir</button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .wrap { display: grid; place-items: center; min-height: 100dvh; padding: 16px; }
      .card { width: min(460px, 100%); }
      .row { display: flex; gap: 10px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
    `,
  ],
})
export class AccessDenied {
  private readonly auth = inject(AuthService);
  private readonly currentUser = inject(CurrentUserService);
  private readonly route = inject(ActivatedRoute);

  readonly profile = this.currentUser.profile;
  readonly error = () => this.currentUser.httpError()?.message ?? '';
  readonly required = this.route.snapshot.queryParamMap.get('required');

  retry() {
    this.currentUser.reload().then(() => {
      if (this.currentUser.profile()) window.location.href = '/';
    });
  }
  signOut() {
    this.auth.signOut();
  }
}
