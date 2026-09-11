import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, switchMap } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth';
import { CurrentUserService } from './current-user';

// Portado de core/auth-interceptor.ts del sistema de asistencia. A cada
// request al backend le pega el x-api-key (filtro anti-bots) y el Bearer
// token de Firebase si hay sesión. Sin sesión, pasa sin el header — el
// backend responde 401 y la UI de login se encarga.
//
// Si el usuario es superadmin y eligió una empresa (ver current-user.ts /
// tenants-page.ts), le suma `?tenantId=` a cada request — el backend lo
// exige para cualquier ruta de negocio cuando quien pide es superadmin
// (appUserMiddleware.js: un superadmin no tiene tenant propio). Las rutas
// que no lo necesitan (`/me`, el listado de empresas) simplemente lo
// ignoran, así que es seguro mandarlo siempre.
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!environment.backendUrl || !req.url.startsWith(environment.backendUrl)) {
    return next(req);
  }
  const auth = inject(AuthService);
  const currentUser = inject(CurrentUserService);
  return from(auth.getIdToken()).pipe(
    switchMap((token) => {
      let headers = req.headers;
      if (environment.apiKey) headers = headers.set('x-api-key', environment.apiKey);
      if (token) headers = headers.set('Authorization', `Bearer ${token}`);

      let outReq = req.clone({ headers });
      const tenant = currentUser.profile()?.isSuperadmin ? currentUser.selectedTenant() : null;
      if (tenant && !outReq.params.has('tenantId')) {
        outReq = outReq.clone({ setParams: { tenantId: String(tenant.id) } });
      }
      return next(outReq);
    })
  );
};
