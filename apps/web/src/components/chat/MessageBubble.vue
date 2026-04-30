<script setup lang="ts">
import { computed } from 'vue';

interface Message {
  id: number | string;
  role: 'ai' | 'user';
  name: string;
  time?: string;
  tag?: string;
  content: string;
}

const props = defineProps<{
  message: Message;
}>();

const isUser = computed(() => props.message.role === 'user');
</script>

<template>
  <div
    :class="[
      'flex gap-6 items-start group',
      isUser ? 'flex-row-reverse' : ''
    ]"
  >
    <!-- Avatar -->
    <div
      :class="[
        'w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center border shadow-xl',
        isUser
          ? 'bg-primary-container border-primary/20 shadow-[0_0_20px_rgba(79,70,229,0.2)]'
          : 'bg-surface-container-high border-outline-variant/10'
      ]"
    >
      <span
        class="material-symbols-outlined text-[20px]"
        :class="isUser ? 'text-on-primary-container' : 'text-primary'"
        :style="!isUser ? 'font-variation-settings: \'FILL\' 1;' : ''"
      >
        {{ isUser ? 'person' : 'smart_toy' }}
      </span>
    </div>

    <!-- Content Area -->
    <div :class="['flex-1 space-y-4', isUser ? 'text-right' : '']">
      <!-- Header -->
      <div
        :class="[
          'flex items-center gap-3',
          isUser ? 'justify-end' : ''
        ]"
      >
        <span v-if="isUser && message.time" class="text-[10px] text-outline font-label">{{ message.time }}</span>
        
        <span class="font-headline font-bold text-sm tracking-tight text-on-surface">{{ message.name }}</span>
        
        <span
          v-if="!isUser && message.tag"
          class="text-[10px] font-label font-medium uppercase tracking-[0.1em] text-outline px-2 py-0.5 bg-surface-container-low rounded border border-outline-variant/5"
        >
          {{ message.tag }}
        </span>
      </div>

      <!-- Body -->
      <div v-if="isUser" class="inline-block p-5 bg-surface-container-low rounded-2xl rounded-tr-none border border-outline-variant/10 text-on-surface-variant text-sm max-w-[80%] text-left" v-html="message.content">
      </div>
      <div v-else class="prose prose-invert max-w-none text-on-surface-variant font-body leading-relaxed text-sm" v-html="message.content">
      </div>
    </div>
  </div>
</template>
