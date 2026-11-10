<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useFeedback } from '@/composables/feedback';
import { notificationsApi, type NotificationRow } from '@/api/admin';
import { useNotificationStore } from '@/stores/notification';
import type { NormalizedError } from '@/api/http';
import EmptyState from '@/components/EmptyState.vue';
import PageHeader from '@/components/PageHeader.vue';

const PAGE_SIZE = 20;
const router = useRouter();
const notifyStore = useNotificationStore();
const { message } = useFeedback();

const tab = ref<'UNREAD' | 'ALL'>('UNREAD');
const items = ref<NotificationRow[]>([]);
const total = ref(0);
const unread = ref(0);
const page = ref(1);
const loading = ref(false);
const markingAll = ref(false);

const isUnreadTab = computed(() => tab.value === 'UNREAD');

function fmtTime(v: string | null | undefined): string {
  return v ? new Date(v).toLocaleString('zh-CN') : '—';
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const params: Record<string, unknown> = { page: page.value, pageSize: PAGE_SIZE };
    if (isUnreadTab.value) params.unreadOnly = '1';
    const data = await notificationsApi.list(params);
    items.value = data.items;
    total.value = data.total;
    unread.value = data.unread;
    notifyStore.unread = data.unread;
  } catch (e) {
    message.error((e as NormalizedError).friendlyMessage ?? '加载失败');
  } finally {
    loading.value = false;
  }
}

function onTabChange(): void {
  page.value = 1;
  void load();
}
function changePage(p: number): void {
  page.value = p;
  void load();
}

/** 点击通知：未读则标记已读；携带 taskId 时可跳转任务详情 */
async function open(row: NotificationRow): Promise<void> {
  if (!row.readAt) {
    try {
      await notificationsApi.markRead(row.id);
      row.readAt = new Date().toISOString();
      unread.value = Math.max(0, unread.value - 1);
      notifyStore.unread = unread.value;
    } catch {
      // 标记失败不影响跳转
    }
  }
  if (row.payload?.taskId) {
    void router.push(`/tasks/${row.payload.taskId}`);
  }
}

async function goTask(row: NotificationRow): Promise<void> {
  if (!row.readAt) {
    try {
      await notificationsApi.markRead(row.id);
      row.readAt = new Date().toISOString();
      unread.value = Math.max(0, unread.value - 1);
      notifyStore.unread = unread.value;
    } catch {
      // 忽略
    }
  }
  void router.push(`/tasks/${row.payload?.taskId}`);
}

async function markAllRead(): Promise<void> {
  markingAll.value = true;
  try {
    await notificationsApi.markAllRead();
    message.success('已全部标记为已读');
    await load();
  } catch (e) {
    message.error((e as NormalizedError).friendlyMessage ?? '操作失败');
  } finally {
    markingAll.value = false;
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <PageHeader title="站内通知" subtitle="任务接单、验收、驳回、结算与提现等进展都会在这里提醒你" />
  <a-card class="block">
    <div class="toolbar">
      <a-tabs v-model:active-key="tab" class="toolbar-tabs" @change="onTabChange">
        <a-tab-pane :tab="`未读（${unread}）`" key="UNREAD" />
        <a-tab-pane tab="全部" key="ALL" />
      </a-tabs>
      <a-button :disabled="unread === 0" :loading="markingAll" @click="markAllRead">全部已读</a-button>
    </div>

    <a-spin :spinning="loading">
      <div class="list-area">
        <div v-if="items.length > 0" class="noti-list">
          <div
            v-for="n in items"
            :key="n.id"
            class="noti-item"
            :class="{ unread: !n.readAt }"
            @click="open(n)"
          >
            <div class="noti-main">
              <span v-if="!n.readAt" class="dot" />
              <span class="noti-title" :class="{ bold: !n.readAt }">{{ n.title }}</span>
              <span class="noti-time">{{ fmtTime(n.createdAt) }}</span>
            </div>
            <div class="noti-body">{{ n.body }}</div>
            <div class="noti-foot">
              <a-tag>{{ n.type }}</a-tag>
              <a-button
                v-if="n.payload?.taskId"
                type="link"
                size="small"
                class="noti-link"
                @click.stop="goTask(n)"
              >
                查看任务 →
              </a-button>
            </div>
          </div>
        </div>
        <EmptyState
          v-else-if="!loading"
          :description="isUnreadTab ? '没有未读通知' : '还没有收到通知'"
        />
      </div>
    </a-spin>

    <div class="pager">
      <a-pagination
        v-model:current="page"
        :page-size="PAGE_SIZE"
        :total="total"
        :show-size-changer="false"
        :hide-on-single-page="true"
        @change="changePage"
      />
    </div>
  </a-card>
</template>

<style scoped>
.block {
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.toolbar-tabs {
  flex: 1;
}
.list-area {
  min-height: 160px;
}
.noti-list {
  border-top: 1px solid var(--sasu-border);
}
.noti-item {
  padding: 14px 8px;
  border-bottom: 1px solid var(--sasu-border);
  cursor: pointer;
  transition: background 0.15s;
}
.noti-item:hover {
  background: var(--sasu-color-primary-light-bg);
}
.noti-main {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--sasu-color-danger);
  flex-shrink: 0;
}
.noti-title {
  color: var(--sasu-text-secondary);
}
.noti-title.bold {
  color: var(--sasu-text-primary);
  font-weight: 600;
}
.noti-time {
  margin-left: auto;
  color: var(--sasu-text-secondary);
  font-size: 12px;
  white-space: nowrap;
}
.noti-body {
  margin-top: 6px;
  padding-left: 16px;
  color: var(--sasu-text-secondary);
  font-size: 13px;
}
.noti-foot {
  margin-top: 8px;
  padding-left: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.noti-link {
  font-size: 13px;
  padding: 0;
}
.pager {
  margin-top: 16px;
  display: flex;
  justify-content: center;
}
</style>
