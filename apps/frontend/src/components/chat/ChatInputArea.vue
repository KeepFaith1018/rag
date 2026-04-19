<script setup lang="ts">
import { ref } from "vue";

const inputText = ref("");

const sendMessage = () => {
  if (!inputText.value.trim()) return;
  // Emit event or call store
  inputText.value = "";
};
</script>

<template>
  <footer
    class="absolute bottom-0 w-full p-6 bg-gradient-to-t from-surface via-surface to-transparent pt-12 z-10 pointer-events-none"
  >
    <div class="max-w-4xl mx-auto relative group pointer-events-auto">
      <!-- Glassmorphism Container -->
      <div
        class="bg-surface-container-low/60 backdrop-blur-2xl rounded-2xl border border-outline-variant/10 p-2 shadow-2xl transition-all focus-within:ring-1 focus-within:ring-primary/40 focus-within:bg-surface-container-high/80"
      >
        <div class="flex items-end gap-2 px-3 py-2">
          <button
            class="p-2 text-outline hover:text-primary transition-colors focus:outline-none"
          >
            <span class="material-symbols-outlined">attach_file</span>
          </button>

          <textarea
            v-model="inputText"
            class="flex-1 bg-transparent border-none focus:ring-0 text-on-surface placeholder:text-outline/50 resize-none py-2 text-sm max-h-48"
            placeholder="向 灵索智能 发送消息..."
            rows="1"
            @keydown.enter.prevent="sendMessage"
          ></textarea>

          <div class="flex items-center gap-2 mb-1">
            <button
              class="p-2 text-outline hover:text-primary transition-colors focus:outline-none"
            >
              <span class="material-symbols-outlined">mic</span>
            </button>
            <button
              class="bg-primary-container hover:bg-primary text-on-primary-container p-2.5 rounded-xl transition-all shadow-lg active:scale-95 flex items-center justify-center focus:outline-none"
              @click="sendMessage"
            >
              <span class="material-symbols-outlined text-[20px]"
                >arrow_upward</span
              >
            </button>
          </div>
        </div>

        <!-- Metadata Row -->
        <div
          class="flex items-center justify-between px-4 py-2 border-t border-outline-variant/5"
        >
          <div class="flex items-center gap-4">
            <button
              class="flex items-center gap-1.5 text-[10px] font-label text-outline hover:text-on-surface transition-colors uppercase tracking-widest focus:outline-none"
            >
              <span class="material-symbols-outlined text-[14px]">tune</span>
              模型设置
            </button>
            <button
              class="flex items-center gap-1.5 text-[10px] font-label text-outline hover:text-on-surface transition-colors uppercase tracking-widest focus:outline-none"
            >
              <span class="material-symbols-outlined text-[14px]"
                >visibility</span
              >
              联网搜索
            </button>
          </div>
          <span
            class="text-[10px] text-outline/40 font-label tracking-tighter italic"
            >正在使用 Linsor-Omni</span
          >
        </div>
      </div>

      <!-- Floating Action Suggestion -->
      <div
        class="absolute -top-10 left-4 flex gap-2 opacity-0 group-focus-within:opacity-100 transition-opacity"
      >
        <button
          class="px-3 py-1 bg-surface-container-high/80 backdrop-blur-md border border-outline-variant/10 rounded-full text-[10px] font-label text-outline hover:text-primary transition-colors focus:outline-none"
        >
          总结分析
        </button>
        <button
          class="px-3 py-1 bg-surface-container-high/80 backdrop-blur-md border border-outline-variant/10 rounded-full text-[10px] font-label text-outline hover:text-primary transition-colors focus:outline-none"
        >
          导出 PDF
        </button>
      </div>
    </div>
  </footer>
</template>
