import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { Role } from '@sasu/shared';

export interface AuthUser {
  id: number;
  name: string;
  role: Role;
}

/**
 * 认证状态（M0 骨架）。
 * M1 接入 /auth/login + httpOnly Cookie + token_version 校验（PRD §7.1）。
 */
export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null);

  const isLoggedIn = computed(() => user.value !== null);
  const role = computed<Role | null>(() => user.value?.role ?? null);

  function setLogin(next: AuthUser): void {
    user.value = next;
  }

  function clear(): void {
    user.value = null;
  }

  return { user, isLoggedIn, role, setLogin, clear };
});
