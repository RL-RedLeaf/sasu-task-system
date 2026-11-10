<script setup lang="ts">
import { ref, watch } from 'vue';
import { promptState, settlePrompt } from '@/composables/feedback';

/** 全局输入弹窗单实例（替代 ElMessageBox.prompt），挂在 AppShell 内。 */
const input = ref('');
const inputRef = ref<{ focus: () => void }>();
const error = ref('');

watch(
  () => promptState.open,
  (open) => {
    if (open) {
      input.value = '';
      error.value = '';
      // 等 modal 挂载后聚焦
      window.setTimeout(() => inputRef.value?.focus(), 80);
    }
  },
);

function onOk(): void {
  const value = input.value;
  const res = promptState.validate?.(value) ?? (value.trim() ? true : '输入不能为空');
  if (res !== true) {
    error.value = res;
    return;
  }
  settlePrompt(value);
}

function onCancel(): void {
  settlePrompt(null);
}
</script>

<template>
  <a-modal
    :open="promptState.open"
    :title="promptState.title"
    :width="440"
    :mask-closable="false"
    ok-text="确定"
    cancel-text="取消"
    @ok="onOk"
    @cancel="onCancel"
  >
    <p v-if="promptState.message" class="prompt-message">{{ promptState.message }}</p>
    <a-input
      ref="inputRef"
      v-model:value="input"
      :placeholder="promptState.placeholder"
      :status="error ? 'error' : ''"
      @press-enter="onOk"
    />
    <p v-if="error" class="prompt-error">{{ error }}</p>
  </a-modal>
</template>

<style scoped>
.prompt-message {
  color: var(--sasu-text-secondary);
  margin: 0 0 8px;
}
.prompt-error {
  color: var(--sasu-color-danger);
  font-size: 12px;
  margin: 6px 0 0;
}
</style>
