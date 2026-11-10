import { ref } from 'vue';
import { defineStore } from 'pinia';
import { notificationsApi } from '@/api/admin';

/** 站内通知：未读数轮询（30s），列表页共享 */
export const useNotificationStore = defineStore('notification', () => {
  const unread = ref(0);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh(): Promise<void> {
    try {
      const r = await notificationsApi.list({ page: 1, pageSize: 1 });
      unread.value = r.unread;
    } catch {
      // 未登录等情况静默
    }
  }

  function startPolling(): void {
    void refresh();
    if (!timer) timer = setInterval(() => void refresh(), 30_000);
  }

  function stopPolling(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { unread, refresh, startPolling, stopPolling };
});
