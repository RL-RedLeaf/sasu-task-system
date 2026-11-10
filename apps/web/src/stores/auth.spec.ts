import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { Role } from '@sasu/shared';
import { useAuthStore } from './auth';

describe('useAuthStore（M0 骨架）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('初始未登录', () => {
    const auth = useAuthStore();
    expect(auth.isLoggedIn).toBe(false);
    expect(auth.role).toBeNull();
  });

  it('setLogin / clear 切换登录态与角色', () => {
    const auth = useAuthStore();
    auth.setLogin({ id: 1, name: '张老师', role: Role.TEACHER });
    expect(auth.isLoggedIn).toBe(true);
    expect(auth.role).toBe(Role.TEACHER);

    auth.clear();
    expect(auth.isLoggedIn).toBe(false);
    expect(auth.user).toBeNull();
  });
});
