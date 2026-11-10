<script setup lang="ts">
/** 全站统一分页：中文总数、隐藏切页大小（对齐原 EP layout="total, prev, pager, next"）。 */
withDefaults(defineProps<{ page: number; pageSize?: number; total: number; hideOnSinglePage?: boolean }>(), {
  pageSize: 20,
  hideOnSinglePage: false,
});
const emit = defineEmits<{ 'update:page': [v: number]; change: [v: number] }>();
</script>

<template>
  <a-pagination
    :current="page"
    :page-size="pageSize"
    :total="total"
    :show-size-changer="false"
    :hide-on-single-page="hideOnSinglePage"
    :show-total="(t: number) => `共 ${t} 条`"
    @change="(p: number) => { emit('update:page', p); emit('change', p); }"
  />
</template>
