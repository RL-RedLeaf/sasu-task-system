<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { message } from '@/composables/feedback';
import type { NormalizedError } from '@/api/http';
import { settingsApi, type ConfigRow } from '@/api/admin';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import type { TableColumnsType } from 'ant-design-vue';

function errMsg(e: unknown): string {
  return (e as NormalizedError).friendlyMessage ?? '操作失败';
}

const loading = ref(false);
const items = ref<ConfigRow[]>([]);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await settingsApi.list();
    items.value = data.items;
  } catch (e) {
    message.error(errMsg(e));
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());

// 按 key 前缀简单分组
interface Group {
  title: string;
  order: number;
  match: (key: string) => boolean;
}
const GROUPS: Group[] = [
  { title: '提现类', order: 1, match: (k) => k.startsWith('WITHDRAW') || k === 'POINT_TO_CASH_RATE' },
  { title: '任务类', order: 2, match: (k) => k.startsWith('TASK') || k.startsWith('REVIEW') || k.startsWith('DEADLINE') || k.startsWith('VIOLATION') || k.startsWith('TOTAL_ISSUE') },
  { title: '安全类', order: 3, match: (k) => k.startsWith('LOGIN') || k.startsWith('SESSION') || k.startsWith('SENSITIVE') || k.startsWith('UPLOAD') },
  { title: '保留期类', order: 4, match: (k) => k.includes('RETENTION') || k.startsWith('AUDIT') },
  { title: '其他', order: 99, match: () => true },
];

/** 参数的中文显示名（管理页主列）；key 保留为辅助小字便于与接口对照 */
const paramNames: Record<string, string> = {
  POINT_TO_CASH_RATE: '积分兑现金汇率',
  WITHDRAW_MIN_POINTS: '最低提现积分',
  WITHDRAW_MONTHLY_LIMIT: '每人每月提现次数',
  WITHDRAW_PERIOD_MODE: '提现额度归属月',
  WITHDRAW_CASH_LIMIT_SINGLE: '单次提现现金上限',
  WITHDRAW_CASH_LIMIT_MONTHLY: '每月提现现金上限',
  WITHDRAW_PENDING_REMIND_DAYS: '提现待发放提醒天数',
  VIOLATION_RATE_BP: '违约金比例（万分比）',
  TASK_REWARD_MIN: '单人赏金下限',
  TASK_REWARD_MAX: '单人赏金上限',
  TASK_TOTAL_MAX: '单任务总额上限',
  TASK_HEADCOUNT_MAX: '任务名额上限',
  TASK_DEADLINE_MIN_HOURS: '截止时间最早提前小时数',
  TASK_DEADLINE_MAX_DAYS: '截止时间最长天数',
  TASK_CONCURRENT_CLAIMS_MAX: '学生同时接单上限',
  TASK_RESUBMIT_WINDOW_HOURS: '驳回后重交窗口时长',
  TASK_REJECT_MAX: '每笔接单最多驳回次数',
  TASK_POST_DEADLINE_REVIEW_DAYS: '截止后验收处理时限',
  TASK_PRICING_REMIND_HOURS: '待定价提醒时点',
  REVIEW_REMIND_DAYS: '验收超时提醒时点',
  DEADLINE_REMIND_HOURS: '任务截止前提醒',
  LOGIN_MAX_FAILS: '登录失败锁定阈值',
  LOGIN_LOCK_MINUTES: '登录锁定时长',
  SESSION_DAYS: '会话保持天数',
  SENSITIVE_REAUTH_MINUTES: '敏感操作再验证时限',
  UPLOAD_MAX_MB: '单文件上传大小上限',
  UPLOAD_MAX_FILES: '单次上传文件数上限',
  NOTIFICATION_READ_RETENTION_DAYS: '已读通知保留天数',
  AUDIT_RETENTION_YEARS: '审计日志保留年数',
  TOTAL_ISSUE_WARN: '累计发行预警线',
};

/** 枚举值的中文翻译（按需补充） */
const ENUM_VALUE_LABELS: Record<string, string> = {
  APPLICATION_MONTH: '按申请月计',
};

function valueText(row: ConfigRow): string {
  if (row.valueType === 'ENUM') return ENUM_VALUE_LABELS[row.value] ?? row.value;
  return row.value;
}

const paramColumns: TableColumnsType = [
  { title: '参数', key: 'param' },
  { title: '当前值', key: 'value', width: 220 },
  { title: '操作', key: 'action', width: 100, fixed: 'right' },
];

const groups = computed(() => {
  const used = new Set<string>();
  const result: { title: string; rows: ConfigRow[] }[] = [];
  for (const g of [...GROUPS].sort((a, b) => a.order - b.order)) {
    const rows = items.value.filter((r) => !used.has(r.key) && g.match(r.key));
    rows.forEach((r) => used.add(r.key));
    if (rows.length > 0) result.push({ title: g.title, rows });
  }
  return result;
});

const valueTypeHints: Record<string, string> = {
  INT: '整数',
  DECIMAL: '小数（如 0.0000）',
  JSON: 'JSON 数组，如 [9, 18]',
  STRING: '文本',
  ENUM: '枚举值',
};

// ---------- 编辑 ----------
const dialogOpen = ref(false);
const saving = ref(false);
const editing = ref<ConfigRow | null>(null);
const editForm = reactive({ value: '' });

function openEdit(row: ConfigRow): void {
  editing.value = row;
  editForm.value = row.value;
  dialogOpen.value = true;
}

async function submitEdit(): Promise<void> {
  if (!editing.value) return;
  const v = editForm.value;
  const t = editing.value.valueType;
  if (t === 'INT' && !/^-?\d+$/.test(v.trim())) {
    message.warning('该配置要求整数格式');
    return;
  }
  if (t === 'DECIMAL' && !/^-?\d+(\.\d+)?$/.test(v.trim())) {
    message.warning('该配置要求小数格式');
    return;
  }
  saving.value = true;
  try {
    await settingsApi.update(editing.value.key, v.trim());
    message.success(`已保存 ${editing.value.key}`);
    dialogOpen.value = false;
    void load();
  } catch (e) {
    message.error(errMsg(e));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <PageHeader title="系统参数设置" subtitle="提现 / 任务 / 安全 / 保留期等运行参数，修改即时生效" />

  <a-spin :spinning="loading">
    <a-card
      v-for="group in groups"
      :key="group.title"
      class="block"
      :class="{ mt16: group.title !== groups[0]?.title }"
      :title="group.title"
    >
      <a-table :columns="paramColumns" :data-source="group.rows" :pagination="false" row-key="key">
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'param'">
            <div class="param-name">
              {{ paramNames[record.key] ?? record.description ?? record.key }}
              <a-tooltip v-if="record.key === 'POINT_TO_CASH_RATE'" title="0 表示提现关闭；改为大于 0 的小数后自动开放学生提现入口">
                <a-tag color="error" class="warn-tag">0 表示提现关闭</a-tag>
              </a-tooltip>
            </div>
            <div class="param-key mono">{{ record.key }}</div>
          </template>
          <template v-else-if="column.key === 'value'">
            <span class="mono">{{ valueText(record as ConfigRow) }}</span>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-button type="link" size="small" class="op-link" @click="openEdit(record as ConfigRow)">编辑</a-button>
          </template>
        </template>
        <template #emptyText><EmptyState /></template>
      </a-table>
    </a-card>
  </a-spin>

  <a-modal v-model:open="dialogOpen" :title="editing ? `编辑：${paramNames[editing.key] ?? editing.key}` : '编辑参数'" :width="480">
    <template v-if="editing">
      <a-alert
        v-if="editing.key === 'POINT_TO_CASH_RATE'"
        type="warning"
        show-icon
        class="mb8"
        message="0 表示提现关闭；修改前请确认不存在待审批/待发放的提现记录。"
      />
      <a-form :label-col="{ style: { width: '90px' } }" @submit.prevent>
        <a-form-item label="当前值">
          <span class="mono">{{ editing.value }}</span>
        </a-form-item>
        <a-form-item :label="`新值（${valueTypeHints[editing.valueType] ?? editing.valueType}）`">
          <a-input v-model:value="editForm.value" :placeholder="valueTypeHints[editing.valueType] ?? '请输入新值'" />
        </a-form-item>
        <p v-if="editing.description" class="tip">{{ editing.description }}</p>
      </a-form>
    </template>
    <template #footer>
      <a-button @click="dialogOpen = false">取消</a-button>
      <a-button type="primary" :loading="saving" @click="submitEdit">保存</a-button>
    </template>
  </a-modal>
</template>

<style scoped>
.mt16 {
  margin-top: 16px;
}
.block {
  border-radius: var(--sasu-radius-base);
  box-shadow: var(--sasu-shadow-card);
}
.mono {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
  font-size: 13px;
}
.param-name {
  font-size: 14px;
  color: var(--sasu-text-primary);
}
.param-key {
  margin-top: 2px;
  font-size: 11px;
  color: var(--sasu-text-secondary);
  opacity: 0.75;
}
.warn-tag {
  margin-left: 8px;
}
.mb8 {
  margin-bottom: 8px;
}
.tip {
  color: var(--sasu-text-secondary);
  font-size: 12px;
  margin: 0 0 0 12px;
}
.op-link {
  padding: 0;
}
</style>
