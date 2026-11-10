<script setup lang="ts">
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import { antdTheme } from '@/theme';
import AppShell from '@/AppShell.vue';
</script>

<template>
  <a-config-provider :locale="zhCN" :theme="antdTheme">
    <a-app>
      <AppShell />
    </a-app>
  </a-config-provider>
</template>
