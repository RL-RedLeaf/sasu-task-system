import { request } from './http';
import type { Role } from '@sasu/shared';

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
}

export const authApi = {
  async login(username: string, password: string): Promise<AuthUser> {
    return request<{ user: AuthUser }>({
      method: 'POST',
      url: '/auth/login',
      data: { username, password },
    }).then((r) => r.user);
  },
  logout(): Promise<void> {
    return request({ method: 'POST', url: '/auth/logout' });
  },
  me(): Promise<AuthUser> {
    return request<AuthUser>({ method: 'GET', url: '/auth/me' });
  },
  changePassword(oldPassword: string, newPassword: string): Promise<void> {
    return request({ method: 'POST', url: '/auth/change-password', data: { oldPassword, newPassword } });
  },
};
