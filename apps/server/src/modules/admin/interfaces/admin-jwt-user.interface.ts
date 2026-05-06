export interface AdminJwtUser {
  sub: string;
  username: string;
  role: 'super_admin' | 'operator';
  isAdmin: true;
}
