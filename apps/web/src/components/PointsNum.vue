<script setup lang="ts">
defineProps<{ value: number | string; suffix?: string }>();
</script>

<template>
  <span class="num">{{ value }}<small v-if="suffix" class="suffix">{{ suffix }}</small></span>
</template>

<style scoped>
.num {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.suffix {
  font-weight: 400;
  margin-left: 2px;
  color: var(--sasu-text-secondary);
}
</style>
