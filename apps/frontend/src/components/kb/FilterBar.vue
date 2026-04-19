<script setup lang="ts">
import { ref } from 'vue';

const currentFilter = ref('all');

const setFilter = (filter: string) => {
  currentFilter.value = filter;
};
</script>

<template>
  <div class="flex items-center justify-between w-full">
    <div class="flex gap-2 bg-surface-container-low p-1.5 rounded-xl border border-outline-variant/10">
      <button
        @click="setFilter('all')"
        :class="[
          'px-5 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 focus:outline-none',
          currentFilter === 'all' ? 'bg-surface-container-high text-on-surface shadow-md' : 'text-outline hover:text-on-surface'
        ]"
      >
        全部文件
      </button>
      <button
        @click="setFilter('private')"
        :class="[
          'px-5 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 focus:outline-none',
          currentFilter === 'private' ? 'bg-surface-container-high text-on-surface shadow-md' : 'text-outline hover:text-on-surface'
        ]"
      >
        私有
      </button>
      <button
        @click="setFilter('shared')"
        :class="[
          'px-5 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 focus:outline-none',
          currentFilter === 'shared' ? 'bg-surface-container-high text-on-surface shadow-md' : 'text-outline hover:text-on-surface'
        ]"
      >
        共享
      </button>
    </div>
    
    <div class="flex items-center gap-4">
      <span class="text-xs font-label uppercase tracking-widest text-outline hidden sm:inline-block">排序方式：修改日期</span>
      <button class="text-outline hover:text-primary transition-colors focus:outline-none group">
        <span class="material-symbols-outlined text-lg group-hover:scale-110 transition-transform">filter_list</span>
      </button>
    </div>
  </div>
</template>
