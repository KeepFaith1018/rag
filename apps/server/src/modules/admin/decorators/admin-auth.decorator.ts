import { SetMetadata } from '@nestjs/common';

export const ADMIN_AUTH_KEY = 'needAdminAuth';
export const ADMIN_ROLE_KEY = 'adminRole';

export const AdminAuth = () => SetMetadata(ADMIN_AUTH_KEY, true);

export const RequireRole = (role: 'super_admin' | 'operator') =>
  SetMetadata(ADMIN_ROLE_KEY, role);
