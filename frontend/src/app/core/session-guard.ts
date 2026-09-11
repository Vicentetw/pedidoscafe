import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth';
import { CurrentUserService } from './current-user';

// Exige sesión de Firebase + perfil de app_users cargado. Manda a /login si
// no hay sesión, a /acceso-denegado si hay sesión pero el backend no
// devuelve perfil (cuenta no habilitada / otra cuenta).
export const sessionGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const currentUser = inject(CurrentUserService);
  const router = inject(Router);

  await auth.ready();
  if (!auth.user()) return router.createUrlTree(['/login']);

  await currentUser.load();
  if (currentUser.profile()) return true;
  if (currentUser.connectionFailed()) return true; // que la pantalla muestre el reintento
  return router.createUrlTree(['/acceso-denegado']);
};
