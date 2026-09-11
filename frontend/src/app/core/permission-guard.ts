import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { CurrentUserService } from './current-user';

// Adaptado de core/permission-guard.ts del sistema de asistencia (sin la
// lógica de suscripción). Uso:
//   { path: 'sucursales', canActivate: [permissionGuard], data: { permission: 'branches:view' } }
//   { path: 'empresas',   canActivate: [permissionGuard], data: { superadminOnly: true } }
export const permissionGuard: CanActivateFn = async (route) => {
  const currentUser = inject(CurrentUserService);
  const router = inject(Router);

  await currentUser.load();

  const required = route.data?.['permission'] as string | undefined;
  const superadminOnly = route.data?.['superadminOnly'] as boolean | undefined;
  if (!required && !superadminOnly) return true;

  if (superadminOnly) {
    if (currentUser.profile()?.isSuperadmin) return true;
    await currentUser.reload();
    if (currentUser.profile()?.isSuperadmin) return true;
    return router.createUrlTree(['/acceso-denegado'], { queryParams: { required: 'superadmin' } });
  }

  if (currentUser.hasPermission(required!)) return true;
  await currentUser.reload();
  if (currentUser.hasPermission(required!)) return true;
  return router.createUrlTree(['/acceso-denegado'], { queryParams: { required } });
};
