<script setup lang="ts">
import { useRouter } from 'vue-router';

interface KbItem {
  id: string | number;
  name: string;
  type: string;
  icon: string;
  color: string;
  docsCount: string;
  size: string;
  createdAt: string;
  users?: string[];
  moreUsers?: number;
}

const props = defineProps<{
  kb: KbItem;
}>();

const router = useRouter();

const goDetail = () => {
  router.push(`/kb/${props.kb.id}`);
};

const typeLabel = props.kb.type === 'private' ? '私有' : '共享';
</script>

<template>
  <div
    @click="goDetail"
    class="group bg-surface-container-low hover:bg-surface-container-high p-8 rounded-[var(--radius-card)] transition-all duration-300 flex flex-col h-72 justify-between cursor-pointer border border-transparent hover:border-outline-variant/10"
    style="box-shadow: var(--shadow-glass); transition: box-shadow 0.3s, transform 0.3s;"
    onmouseover="this.style.boxShadow='var(--shadow-hover)'"
    onmouseout="this.style.boxShadow='var(--shadow-glass)'"
  >
    <div class="flex justify-between items-start">
      <div
        class="w-12 h-12 rounded flex items-center justify-center transition-transform group-hover:-translate-y-1 duration-300 shadow-md"
        :class="`bg-${kb.color}-container/10`"
      >
        <span
          class="material-symbols-outlined"
          :class="`text-${kb.color}`"
          style="font-variation-settings: 'FILL' 1;"
        >
          {{ kb.icon }}
        </span>
      </div>
      <span
        class="text-[10px] font-label tracking-widest uppercase px-2 py-1 rounded shadow-sm"
        :class="`text-${kb.color} bg-${kb.color}-container/20`"
      >
        {{ typeLabel }}
      </span>
    </div>

    <div class="mt-4 flex-1">
      <h3
        class="font-headline text-xl font-bold mb-2 transition-colors duration-300"
        :class="`group-hover:text-${kb.color}`"
      >
        {{ kb.name }}
      </h3>
      <div class="flex items-center gap-4 text-outline text-xs mt-3">
        <span class="flex items-center gap-1.5 opacity-80">
          <span class="material-symbols-outlined text-[16px]">description</span>
          {{ kb.docsCount }} 文档
        </span>
        <span class="flex items-center gap-1.5 opacity-80">
          <span class="material-symbols-outlined text-[16px]">storage</span>
          {{ kb.size }}
        </span>
      </div>
    </div>

    <div class="flex items-center justify-between pt-6 border-t border-outline-variant/10 mt-auto">
      <div class="flex -space-x-2">
        <img
          v-for="(imgUrl, idx) in kb.users"
          :key="idx"
          class="w-8 h-8 rounded-full border-2 border-surface-container-low object-cover transition-transform group-hover:scale-105 duration-300"
          :src="imgUrl"
          alt="user"
        />
        <div
          v-if="kb.moreUsers"
          class="w-8 h-8 rounded-full border-2 border-surface-container-low bg-surface-variant flex items-center justify-center text-[10px] font-bold text-on-surface-variant z-10 transition-colors group-hover:bg-surface-container-highest"
        >
          +{{ kb.moreUsers }}
        </div>
      </div>
      <span class="text-[10px] font-label text-outline/80 uppercase tracking-wider">创建于 {{ kb.createdAt }}</span>
    </div>
  </div>
</template>

<style scoped>
/* Support dynamic classes for colors to adapt perfectly to Light/Dark modes */
.bg-primary-container\/10 { background-color: color-mix(in srgb, var(--color-primary) 15%, transparent); }
.bg-primary-container\/20 { background-color: color-mix(in srgb, var(--color-primary) 25%, transparent); }
.text-primary { color: var(--color-primary); }
.group-hover\:text-primary:hover { color: var(--color-primary); }

.bg-secondary-container\/10 { background-color: color-mix(in srgb, var(--color-secondary) 15%, transparent); }
.bg-secondary-container\/20 { background-color: color-mix(in srgb, var(--color-secondary) 25%, transparent); }
.bg-on-secondary-fixed-variant\/10 { background-color: color-mix(in srgb, var(--color-secondary) 15%, transparent); }
.bg-on-secondary-fixed-variant\/20 { background-color: color-mix(in srgb, var(--color-secondary) 25%, transparent); }
.text-secondary { color: var(--color-secondary); }
.group-hover\:text-secondary:hover { color: var(--color-secondary); }

.bg-tertiary-container\/10 { background-color: color-mix(in srgb, var(--color-tertiary) 15%, transparent); }
.bg-tertiary-container\/20 { background-color: color-mix(in srgb, var(--color-tertiary) 25%, transparent); }
.text-tertiary { color: var(--color-tertiary); }
.group-hover\:text-tertiary:hover { color: var(--color-tertiary); }
</style>
