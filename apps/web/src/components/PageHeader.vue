<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>();
</script>

<template>
  <div class="page-header">
    <h2 class="page-title">{{ title }}</h2>
    <p v-if="subtitle" class="page-subtitle">{{ subtitle }}</p>
  </div>
</template>

<style scoped>
.page-header {
  margin-bottom: 16px;
}
.page-title {
  font-size: 20px;
  margin: 0 0 4px;
}
.page-subtitle {
  margin: 0;
  color: var(--sasu-text-secondary);
  font-size: 13px;
}
</style>
