import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { Role, type Role as RoleType } from '@sasu/shared';
import { authApi, type AuthUser } from '@/api/auth';
import { http } from '@/api/http';

/**
 * 认证状态：登录写 httpOnly Cookie（服务端），这里只维护用户信息。
 * token_version 由后端校验：禁用/改密后下一次请求即 401。
 */
export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null);
  const loaded = ref(false);

  const isLoggedIn = computed(() => user.value !== null);
  const role = computed<RoleType | null>(() => user.value?.role ?? null);
  const mustChangePassword = computed(() => user.value?.mustChangePassword ?? false);

  async function login(username: string, password: string): Promise<AuthUser> {
    const u = await authApi.login(username, password);
    user.value = u;
    loaded.value = true;
    return u;
  }

  async function fetchMe(): Promise<AuthUser | null> {
    try {
      user.value = await authApi.me();
    } catch {
      user.value = null;
    }
    loaded.value = true;
    return user.value;
  }

  async function logout(): Promise<void> {
    try {
      await authApi.logout();
    } catch {
      // 忽略：本地清理即可
    }
    user.value = null;
    http.defaults.headers.common = {};
  }

  function reset(): void {
    user.value = null;
    loaded.value = false;
  }

  return { user, loaded, isLoggedIn, role, mustChangePassword, login, fetchMe, logout, reset };
});

export { Role };
