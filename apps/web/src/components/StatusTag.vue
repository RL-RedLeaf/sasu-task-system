<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ status: string }>();

/** 状态标签配色（PRD §13.4）：待定价=紫、招募中=蓝、已满=灰、待验收=橙、已完成=绿、已取消=灰、下架=深灰、违约=红 */
const MAP: Record<string, { label: string; type: 'primary' | 'success' | 'warning' | 'danger' | 'info' }> = {
  PENDING_REWARD: { label: '待定价', type: 'warning' },
  RECRUITING: { label: '招募中', type: 'primary' },
  FULL: { label: '已满', type: 'info' },
  OFFLINE: { label: '已下架', type: 'info' },
  CLOSED: { label: '已截止', type: 'info' },
  SETTLED: { label: '已完成', type: 'success' },
  CANCELLED: { label: '已取消', type: 'info' },
  CLAIMED: { label: '进行中', type: 'primary' },
  SUBMITTED: { label: '待验收', type: 'warning' },
  ACCEPTED: { label: '已通过', type: 'success' },
  REJECTED: { label: '被驳回', type: 'danger' },
  FAILED: { label: '未完成', type: 'danger' },
  OVERDUE: { label: '违约', type: 'danger' },
  WITHDRAWN: { label: '已取消', type: 'info' },
  CANCELLED_BY_TEACHER: { label: '已取消', type: 'info' },
  PENDING: { label: '待审批', type: 'warning' },
  APPROVED: { label: '待发放', type: 'primary' },
  PAID: { label: '已发放', type: 'success' },
  WITHDRAWN_W: { label: '已撤回', type: 'info' },
  OPEN: { label: '进行中', type: 'primary' },
  RESOLVED: { label: '已裁定', type: 'success' },
  REJECTED_D: { label: '已驳回', type: 'info' },
};

const info = computed(() => MAP[props.status] ?? { label: props.status, type: 'info' as const });
</script>

<template>
  <el-tag :type="info.type" size="small" disable-transitions>{{ info.label }}</el-tag>
</template>
