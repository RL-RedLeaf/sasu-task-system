<script setup lang="ts">
import { antdTheme } from '@/theme';
import AppShell from '@/AppShell.vue';
</script>

<template>
  <a-config-provider :theme="antdTheme">
    <a-app>
      <AppShell />
    </a-app>
  </a-config-provider>
</template>
