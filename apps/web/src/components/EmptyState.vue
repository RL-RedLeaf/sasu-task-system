<script setup lang="ts">
defineProps<{ description?: string }>();
</script>

<template>
  <a-empty :description="description ?? '这里还没有内容'">
    <slot />
  </a-empty>
</template>
