import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth';

export interface SelectedTenant { id: number; name: string; }

export interface CurrentUserProfile {
  id: number;
  email: string;
  displayName: string | null;
  tenantId: number | null;
  tenantName: string | null;
  defaultBranchId: number | null;
  isSuperadmin: boolean;
  permissions: string[];
}

// Adaptado de core/current-user.ts del sistema de asistencia. Envuelve
// GET /api/platform/users/me. Sin la lógica de suscripción/billing (eso es
// la Fase 6b). Mantiene los reintentos ante cold-start / red lenta para no
// entrar al shell con un perfil vacío.
@Injectable({ providedIn: 'root' })
export class CurrentUserService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  readonly profile = signal<CurrentUserProfile | null>(null);
  // Sólo aplica al superadmin: qué empresa está operando ahora mismo (el
  // backend exige ?tenantId= explícito para cualquier ruta de negocio
  // cuando el usuario es superadmin — ver appUserMiddleware.js). Se
  // persiste para sobrevivir un refresh de la pestaña.
  readonly selectedTenant = signal<SelectedTenant | null>(this.readSelectedTenant());
  readonly loaded = signal(false);
  readonly connecting = signal(false);
  readonly connectionFailed = signal(false);
  readonly httpError = signal<{ status: number | null; message: string } | null>(null);

  private permissionSet = new Set<string>();
  private loadPromise: Promise<void> | null = null;
  private loadedForUid: string | null = null;

  private readonly MAX_ATTEMPTS = 5;
  private readonly FIRST_TIMEOUT_MS = 8000;
  private readonly ATTEMPT_TIMEOUT_MS = 20000;

  load(): Promise<void> {
    const uid = this.auth.user()?.uid ?? null;
    if (this.loadPromise && this.loadedForUid === uid) return this.loadPromise;
    this.loaded.set(false);
    this.connectionFailed.set(false);
    this.loadedForUid = uid;
    this.loadPromise = this.run();
    return this.loadPromise;
  }

  reload(): Promise<void> {
    this.loadPromise = null;
    return this.load();
  }

  private async run(): Promise<void> {
    for (let n = 1; n <= this.MAX_ATTEMPTS; n++) {
      const ms = n === 1 ? this.FIRST_TIMEOUT_MS : this.ATTEMPT_TIMEOUT_MS;
      try {
        const profile = await firstValueFrom(
          this.http
            .get<CurrentUserProfile>(`${environment.backendUrl}/api/platform/users/me`)
            .pipe(timeout(ms))
        );
        this.profile.set(profile ?? null);
        this.permissionSet = new Set(profile?.permissions ?? []);
        this.httpError.set(null);
        this.connecting.set(false);
        this.loaded.set(true);
        return;
      } catch (err) {
        const httpErr = err instanceof HttpErrorResponse ? err : null;
        const status = httpErr ? httpErr.status : 0;
        const retryable = !httpErr || status === 0 || status === 429 || status >= 500;
        if (retryable && n < this.MAX_ATTEMPTS) {
          this.connecting.set(true);
          await new Promise((r) => setTimeout(r, Math.min(2000 * n, 6000)));
          continue;
        }
        this.profile.set(null);
        this.permissionSet = new Set();
        this.httpError.set({
          status: httpErr ? httpErr.status : null,
          message: httpErr?.error?.error || httpErr?.message || 'La conexión tardó demasiado.',
        });
        this.connecting.set(false);
        if (retryable) this.connectionFailed.set(true);
        else this.loaded.set(true);
        return;
      }
    }
  }

  // 'modulo:accion'. El superadmin se salta cualquier chequeo (igual que
  // requirePermission en el backend).
  hasPermission(permission: string): boolean {
    const p = this.profile();
    if (!p) return false;
    if (p.isSuperadmin) return true;
    return this.permissionSet.has(permission);
  }

  private readSelectedTenant(): SelectedTenant | null {
    try {
      const raw = localStorage.getItem('pc.superadmin.tenant');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  setSelectedTenant(t: SelectedTenant | null) {
    this.selectedTenant.set(t);
    try {
      if (t) localStorage.setItem('pc.superadmin.tenant', JSON.stringify(t));
      else localStorage.removeItem('pc.superadmin.tenant');
    } catch { /* ignore */ }
  }
}
