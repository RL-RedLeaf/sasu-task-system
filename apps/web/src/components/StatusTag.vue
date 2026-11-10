<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ status: string }>();

/** 状态标签配色（PRD §13.4）：待定价=橙、招募中=红(品牌)、已满=灰、待验收=橙、已完成=绿、已取消=灰、下架=深灰、违约=红 */
const MAP: Record<string, { label: string; color: 'red' | 'success' | 'warning' | 'error' | 'default' }> = {
  PENDING_REWARD: { label: '待定价', color: 'warning' },
  RECRUITING: { label: '招募中', color: 'red' },
  FULL: { label: '已满', color: 'default' },
  OFFLINE: { label: '已下架', color: 'default' },
  CLOSED: { label: '已截止', color: 'default' },
  SETTLED: { label: '已完成', color: 'success' },
  CANCELLED: { label: '已取消', color: 'default' },
  CLAIMED: { label: '进行中', color: 'red' },
  SUBMITTED: { label: '待验收', color: 'warning' },
  ACCEPTED: { label: '已通过', color: 'success' },
  REJECTED: { label: '被驳回', color: 'error' },
  FAILED: { label: '未完成', color: 'error' },
  OVERDUE: { label: '违约', color: 'error' },
  WITHDRAWN: { label: '已取消', color: 'default' },
  CANCELLED_BY_TEACHER: { label: '已取消', color: 'default' },
  PENDING: { label: '待审批', color: 'warning' },
  APPROVED: { label: '待发放', color: 'red' },
  PAID: { label: '已发放', color: 'success' },
  WITHDRAWN_W: { label: '已撤回', color: 'default' },
  OPEN: { label: '进行中', color: 'red' },
  RESOLVED: { label: '已裁定', color: 'success' },
  REJECTED_D: { label: '已驳回', color: 'default' },
  // 账号状态（原 EP 直接展示英文原值，此处补中文映射）
  ACTIVE: { label: '正常', color: 'success' },
  DISABLED: { label: '已禁用', color: 'error' },
};

const info = computed(() => MAP[props.status] ?? { label: props.status, color: 'default' as const });
</script>

<template>
  <a-tag :color="info.color" class="status-tag">{{ info.label }}</a-tag>
</template>

<style scoped>
.status-tag {
  margin-inline-end: 0;
}
</style>
