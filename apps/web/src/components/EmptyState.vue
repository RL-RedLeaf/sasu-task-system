<script setup lang="ts">
defineProps<{ description?: string }>();
</script>

<template>
  <el-empty :description="description ?? '这里还没有内容'">
    <slot />
  </el-empty>
</template>
