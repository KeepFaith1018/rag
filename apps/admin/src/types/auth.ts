export interface AdminUser {
  id: string;
  username: string;
  role: "super_admin" | "operator";
  isActive: boolean;
}

export interface LoginPayload {
  username: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  admin: AdminUser;
}

export interface RefreshResponse {
  accessToken: string;
}
