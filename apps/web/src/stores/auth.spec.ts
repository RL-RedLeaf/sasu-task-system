import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAuthStore } from './auth';

describe('useAuthStore（前端会话状态）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('初始未登录', () => {
    const auth = useAuthStore();
    expect(auth.isLoggedIn).toBe(false);
    expect(auth.role).toBeNull();
    expect(auth.mustChangePassword).toBe(false);
  });

  it('reset 清空会话', async () => {
    const auth = useAuthStore();
    // 直接触发内部状态（绕过 API）
    auth.$patch({ user: { id: '1', username: 't1', name: 'T', role: 'TEACHER', mustChangePassword: false }, loaded: true } as never);
    expect(auth.isLoggedIn).toBe(true);
    auth.reset();
    expect(auth.isLoggedIn).toBe(false);
    expect(auth.loaded).toBe(false);
  });
});
