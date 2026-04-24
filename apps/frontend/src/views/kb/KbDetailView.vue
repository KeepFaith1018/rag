<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useChunkUpload } from "@/modules/document-upload/composables/useChunkUpload";

const router = useRouter();
const route = useRoute();
const fileInputRef = ref<HTMLInputElement | null>(null);
const { state, isUploading, startUpload, cancel } = useChunkUpload();

const kbId = computed(() => String(route.params.id || ""));

const uploadStatusText = computed(() => {
  switch (state.status) {
    case "hashing":
      return "正在计算文件哈希，准备执行秒传与断点续传校验";
    case "initializing":
      return "正在初始化上传会话";
    case "uploading":
      return `正在上传分片，已完成 ${state.progress}%`;
    case "merging":
      return "分片上传完成，正在请求服务端合并";
    case "completed":
      return "上传完成，文档已进入后端处理入口状态";
    case "instantCompleted":
      return "命中秒传，已直接复用已有源文件";
    case "failed":
      return state.errorMessage || "上传失败，请稍后重试";
    default:
      return "拖拽 PDF、Word、TXT 或 Markdown 文件至此，体验分片上传、断点续传与秒传";
  }
});

const goBack = () => {
  router.back();
};

const openFilePicker = () => {
  fileInputRef.value?.click();
};

const handleFileChange = async (event: Event) => {
  const target = event.target as HTMLInputElement | null;
  const file = target?.files?.[0];

  if (!file || !kbId.value) {
    return;
  }

  try {
    await startUpload({
      kbId: kbId.value,
      file,
    });
  } finally {
    if (target) {
      target.value = "";
    }
  }
};

const cancelCurrentUpload = async () => {
  if (!kbId.value || !state.uploadId) {
    return;
  }

  await cancel(kbId.value);
};
</script>

<template>
  <div class="flex flex-col h-full w-full relative bg-surface">
    <!-- Header Section -->
    <header
      class="bg-surface/80 backdrop-blur-xl sticky top-0 z-40 px-6 md:px-8 h-20 flex items-center justify-between border-b border-outline-variant/5"
    >
      <div class="flex items-center gap-4">
        <button
          @click="goBack"
          class="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-surface-container-high transition-colors focus:outline-none"
        >
          <span
            class="material-symbols-outlined text-on-surface-variant text-xl"
            >arrow_back</span
          >
        </button>
        <div>
          <h2
            class="font-headline text-2xl font-bold tracking-tight text-on-surface"
          >
            神经引擎文档
          </h2>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <div class="flex -space-x-2 mr-4 hidden sm:flex">
          <img
            alt="User"
            class="w-8 h-8 rounded-full border-2 border-surface object-cover"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuAvAKwYawX9QdTRQsXTAJGN0Yf14LH9FbwciVtk3Q7opU51JNCc3LFh_sPmJfYbJL_m8YMN2kwGrP5JwIJw8O6Q3GY0V8qkHayYxylC2T9HSc_FSUQ9IqoLeGxl7fSHA_wWMFqW5bb8EFjg-fUGbVGaLxR2Chg4pg5zZrGFBDer4xbJfWGYLNFmp5nnPZpTHLDFZsSCfOmi2xtE5VeXd7rkBviJiQzL0Q3d5XwLLXzc-lB-GWeSTwTl6OPsUg2rP8_w9nL80UBZdJVU"
          />
          <img
            alt="User"
            class="w-8 h-8 rounded-full border-2 border-surface object-cover"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuB7wWX9NK8L-0CGOCThW36cKWJmeI24a9tyDd8ZUcy5P6FOayGS-h3-uyy6ZLS_XS4TPlbk3wSxECWcQCg9pq63FXz9Q-8obF1YFUW9pCbsJQIEAzW29XFcC31JwhyNRAfzZ_WKQ6ziXP5gd7N7AIXe6ibjz-NwL6Xxa_F5_Xi_bOYLC1TpQyMZAx7BXGWHMSqyBSGcB-muAnILADvrcoyH4cATgLEn_05-b4fpWSgQEVG_NYMGqskmrAvXhlqhsmNjvJDKs2QZ2Fqs"
          />
          <div
            class="w-8 h-8 rounded-full border-2 border-surface bg-surface-container-highest flex items-center justify-center text-[10px] font-bold text-on-surface-variant"
          >
            +4
          </div>
        </div>
        <button
          class="bg-primary-container text-on-primary-container px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2 hover:brightness-110 transition-all active:scale-95 shadow-[0_0_15px_rgba(79,70,229,0.15)] focus:outline-none"
        >
          <span class="material-symbols-outlined text-sm">sync</span>
          全部重新索引
        </button>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto px-6 md:px-8 pb-12 pt-6">
      <!-- Navigation Tabs -->
      <div class="flex gap-8 mb-8 border-b border-outline-variant/10">
        <button
          class="pb-4 text-sm font-semibold text-primary border-b-2 border-primary focus:outline-none transition-colors"
        >
          文档
        </button>
        <button
          class="pb-4 text-sm font-medium text-on-surface-variant hover:text-on-surface transition-colors focus:outline-none"
        >
          成员
        </button>
        <button
          class="pb-4 text-sm font-medium text-on-surface-variant hover:text-on-surface transition-colors focus:outline-none"
        >
          设置
        </button>
      </div>

      <!-- Bento Grid Layout -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <!-- Left: Upload & List (8 cols) -->
        <div class="lg:col-span-8 flex flex-col gap-6">
          <!-- Upload Zone -->
          <div
            class="bg-surface-container-low p-8 rounded-xl border border-dashed border-outline-variant/20 flex flex-col items-center justify-center group hover:border-primary/40 transition-all cursor-pointer shadow-md"
            @click="openFilePicker"
          >
            <input
              ref="fileInputRef"
              type="file"
              class="hidden"
              accept=".pdf,.doc,.docx,.txt,.md"
              @change="handleFileChange"
            />
            <div
              class="w-16 h-16 bg-surface-container-high rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform shadow-inner"
            >
              <span
                class="material-symbols-outlined text-3xl text-primary drop-shadow-[0_0_8px_rgba(195,192,255,0.5)]"
                >cloud_upload</span
              >
            </div>
            <h3
              class="font-headline text-lg font-bold mb-1 group-hover:text-primary transition-colors"
            >
              上传知识资产
            </h3>
            <p class="text-on-surface-variant text-sm mb-6">
              {{ uploadStatusText }}
            </p>
            <div
              v-if="state.status !== 'idle'"
              class="w-full max-w-xl mb-6"
            >
              <div
                class="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden shadow-inner"
              >
                <div
                  class="bg-primary h-full rounded-full transition-all duration-300"
                  :style="{ width: `${state.progress}%` }"
                ></div>
              </div>
              <div
                class="mt-3 flex items-center justify-between text-xs text-on-surface-variant"
              >
                <span class="truncate">{{ state.fileName || '等待选择文件' }}</span>
                <span>{{ state.progress }}%</span>
              </div>
            </div>
            <div class="flex items-center gap-3">
            <button
              type="button"
              @click.stop="openFilePicker"
              class="px-6 py-2 bg-surface-container-highest rounded-md text-sm font-semibold hover:bg-surface-bright transition-colors focus:outline-none shadow-sm"
            >
              浏览文件
            </button>
              <button
                v-if="isUploading && state.uploadId"
                type="button"
                @click.stop="cancelCurrentUpload"
                class="px-6 py-2 rounded-md text-sm font-semibold border border-outline-variant/15 hover:bg-surface-container-high transition-colors focus:outline-none shadow-sm"
              >
                取消上传
              </button>
            </div>
          </div>

          <div
            v-if="state.status !== 'idle'"
            class="bg-surface-container-low rounded-xl overflow-hidden shadow-lg border border-outline-variant/5"
          >
            <div
              class="px-6 py-4 flex justify-between items-center border-b border-outline-variant/5 bg-surface-container-high/30"
            >
              <h4
                class="text-sm font-bold uppercase tracking-widest text-on-surface-variant font-label"
              >
                当前上传任务
              </h4>
              <span
                class="px-2 py-1 rounded-full text-[10px] font-bold uppercase bg-primary/10 text-primary"
              >
                {{ state.status }}
              </span>
            </div>
            <div class="px-6 py-5 flex items-center gap-4">
              <div
                class="w-10 h-10 bg-primary/10 rounded flex items-center justify-center flex-shrink-0"
              >
                <span class="material-symbols-outlined text-primary"
                  >cloud_upload</span
                >
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-2">
                  <span class="font-semibold text-sm truncate">
                    {{ state.fileName || "等待文件选择" }}
                  </span>
                  <span
                    class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary uppercase"
                  >
                    {{ state.progress }}%
                  </span>
                </div>
                <div
                  class="w-full bg-surface-container-highest h-1 rounded-full overflow-hidden shadow-inner"
                >
                  <div
                    class="bg-primary h-full rounded-full transition-all duration-300"
                    :style="{ width: `${state.progress}%` }"
                  ></div>
                </div>
                <p class="text-xs text-on-surface-variant mt-2">
                  已上传分片 {{ state.uploadedChunks.length }} / {{ state.totalChunks }}
                </p>
              </div>
            </div>
          </div>

          <!-- Documents List -->
          <div
            class="bg-surface-container-low rounded-xl overflow-hidden shadow-lg border border-outline-variant/5"
          >
            <div
              class="px-6 py-4 flex justify-between items-center border-b border-outline-variant/5 bg-surface-container-high/30"
            >
              <h4
                class="text-sm font-bold uppercase tracking-widest text-on-surface-variant font-label"
              >
                当前文件 (12)
              </h4>
              <div class="flex gap-2">
                <button
                  class="p-2 rounded hover:bg-surface-container-high transition-colors focus:outline-none"
                >
                  <span class="material-symbols-outlined text-sm"
                    >filter_list</span
                  >
                </button>
                <button
                  class="p-2 rounded hover:bg-surface-container-high transition-colors focus:outline-none"
                >
                  <span class="material-symbols-outlined text-sm">search</span>
                </button>
              </div>
            </div>

            <div class="divide-y divide-outline-variant/5">
              <!-- Processing File -->
              <div
                class="px-6 py-5 flex flex-col sm:flex-row sm:items-center gap-4 hover:bg-surface-container-high/50 transition-colors group cursor-pointer"
              >
                <div
                  class="w-10 h-10 bg-error-container/20 rounded flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform"
                >
                  <span class="material-symbols-outlined text-error"
                    >picture_as_pdf</span
                  >
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-2">
                    <span
                      class="font-semibold text-sm truncate group-hover:text-primary transition-colors"
                      >Core_Architecture_v2.pdf</span
                    >
                    <span
                      class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary uppercase animate-pulse"
                      >解析中</span
                    >
                  </div>
                  <div
                    class="w-full bg-surface-container-highest h-1 rounded-full overflow-hidden shadow-inner"
                  >
                    <div
                      class="bg-primary h-full w-[65%] rounded-full shadow-[0_0_8px_var(--color-primary)]"
                    ></div>
                  </div>
                </div>
                <div class="text-left sm:text-right mt-2 sm:mt-0">
                  <p
                    class="text-[10px] font-bold text-on-surface-variant font-label uppercase"
                  >
                    12.4 MB
                  </p>
                  <p class="text-[10px] text-primary font-medium mt-1">
                    已完成 65%
                  </p>
                </div>
                <button
                  class="hidden sm:block ml-4 p-2 text-on-surface-variant hover:text-on-surface transition-colors focus:outline-none"
                >
                  <span class="material-symbols-outlined">more_vert</span>
                </button>
              </div>

              <!-- Ready File 1 -->
              <div
                class="px-6 py-5 flex flex-col sm:flex-row sm:items-center gap-4 hover:bg-surface-container-high/50 transition-colors group cursor-pointer"
              >
                <div
                  class="w-10 h-10 bg-secondary-container/20 rounded flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform"
                >
                  <span class="material-symbols-outlined text-secondary"
                    >description</span
                  >
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <span
                      class="font-semibold text-sm truncate group-hover:text-primary transition-colors"
                      >User_Behavior_Analysis.md</span
                    >
                    <span
                      class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-secondary/10 text-secondary uppercase shadow-sm"
                      >就绪</span
                    >
                  </div>
                  <p class="text-xs text-on-surface-variant mt-1">
                    最后更新于 2023年10月24日
                  </p>
                </div>
                <div class="text-left sm:text-right mt-2 sm:mt-0">
                  <p
                    class="text-[10px] font-bold text-on-surface-variant font-label uppercase"
                  >
                    842 KB
                  </p>
                  <p
                    class="text-[10px] text-on-surface-variant font-medium mt-1"
                  >
                    2,402 切片
                  </p>
                </div>
                <button
                  class="hidden sm:block ml-4 p-2 text-on-surface-variant hover:text-on-surface transition-colors focus:outline-none"
                >
                  <span class="material-symbols-outlined">more_vert</span>
                </button>
              </div>

              <!-- Ready File 2 -->
              <div
                class="px-6 py-5 flex flex-col sm:flex-row sm:items-center gap-4 hover:bg-surface-container-high/50 transition-colors group cursor-pointer"
              >
                <div
                  class="w-10 h-10 bg-tertiary-container/20 rounded flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform"
                >
                  <span class="material-symbols-outlined text-tertiary"
                    >code</span
                  >
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <span
                      class="font-semibold text-sm truncate group-hover:text-primary transition-colors"
                      >API_Endpoints_Schema.json</span
                    >
                    <span
                      class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-secondary/10 text-secondary uppercase shadow-sm"
                      >就绪</span
                    >
                  </div>
                  <p class="text-xs text-on-surface-variant mt-1">
                    最后更新于 2023年10月22日
                  </p>
                </div>
                <div class="text-left sm:text-right mt-2 sm:mt-0">
                  <p
                    class="text-[10px] font-bold text-on-surface-variant font-label uppercase"
                  >
                    2.1 MB
                  </p>
                  <p
                    class="text-[10px] text-on-surface-variant font-medium mt-1"
                  >
                    512 切片
                  </p>
                </div>
                <button
                  class="hidden sm:block ml-4 p-2 text-on-surface-variant hover:text-on-surface transition-colors focus:outline-none"
                >
                  <span class="material-symbols-outlined">more_vert</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Right: Stats & Settings (4 cols) -->
        <div class="lg:col-span-4 flex flex-col gap-6">
          <!-- Stats Card -->
          <div
            class="bg-surface-container-low rounded-xl p-6 relative overflow-hidden shadow-lg border border-outline-variant/5"
          >
            <div class="absolute -right-4 -top-4 opacity-5">
              <span class="material-symbols-outlined text-[120px]"
                >database</span
              >
            </div>
            <h4
              class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-label mb-6"
            >
              数据库健康度
            </h4>
            <div class="space-y-6 relative z-10">
              <div>
                <div class="flex justify-between items-end mb-2">
                  <span
                    class="text-3xl font-headline font-bold text-primary drop-shadow-[0_0_8px_rgba(195,192,255,0.2)]"
                    >8.2k</span
                  >
                  <span class="text-xs text-on-surface-variant">总切片数</span>
                </div>
                <div
                  class="w-full bg-surface-container-highest h-1.5 rounded-full overflow-hidden shadow-inner"
                >
                  <div
                    class="bg-primary h-full w-[45%] shadow-[0_0_8px_var(--color-primary)]"
                  ></div>
                </div>
                <p
                  class="mt-2 text-[10px] text-on-surface-variant uppercase tracking-wider"
                >
                  已用 45% (上限 20k)
                </p>
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div
                  class="bg-surface-container-high p-4 rounded-lg shadow-sm border border-outline-variant/5"
                >
                  <p
                    class="text-[10px] text-on-surface-variant font-bold uppercase mb-1"
                  >
                    平均延迟
                  </p>
                  <p class="text-xl font-headline font-bold">142ms</p>
                </div>
                <div
                  class="bg-surface-container-high p-4 rounded-lg shadow-sm border border-outline-variant/5"
                >
                  <p
                    class="text-[10px] text-on-surface-variant font-bold uppercase mb-1"
                  >
                    嵌入向量
                  </p>
                  <p class="text-xl font-headline font-bold text-primary">
                    ADA-002
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- Quick Settings Card -->
          <div
            class="bg-surface-container-low rounded-xl p-6 shadow-lg border border-outline-variant/5"
          >
            <h4
              class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-label mb-4"
            >
              快速设置
            </h4>
            <div class="space-y-4">
              <div
                class="flex items-center justify-between p-3 bg-surface-container-high rounded-lg group cursor-pointer hover:bg-surface-bright transition-colors shadow-sm"
              >
                <div class="flex items-center gap-3">
                  <span
                    class="material-symbols-outlined text-primary drop-shadow-[0_0_5px_rgba(195,192,255,0.4)]"
                    >auto_awesome</span
                  >
                  <div class="text-xs">
                    <p
                      class="font-bold group-hover:text-primary transition-colors"
                    >
                      自动同步
                    </p>
                    <p class="text-on-surface-variant mt-0.5">每 15 分钟</p>
                  </div>
                </div>
                <div
                  class="w-8 h-4 bg-primary-container rounded-full relative shadow-inner"
                >
                  <div
                    class="absolute right-0.5 top-0.5 w-3 h-3 bg-white rounded-full shadow-sm"
                  ></div>
                </div>
              </div>

              <div
                class="flex items-center justify-between p-3 bg-surface-container-high rounded-lg group cursor-pointer hover:bg-surface-bright transition-colors shadow-sm"
              >
                <div class="flex items-center gap-3">
                  <span
                    class="material-symbols-outlined text-on-surface-variant group-hover:text-primary transition-colors"
                    >translate</span
                  >
                  <div class="text-xs">
                    <p
                      class="font-bold group-hover:text-primary transition-colors"
                    >
                      多语言
                    </p>
                    <p class="text-on-surface-variant mt-0.5">
                      英语, 德语, 法语
                    </p>
                  </div>
                </div>
                <span
                  class="material-symbols-outlined text-sm text-on-surface-variant group-hover:text-primary transition-colors"
                  >chevron_right</span
                >
              </div>

              <button
                class="w-full py-3 mt-4 border border-outline-variant/20 rounded-md text-xs font-bold uppercase tracking-widest hover:bg-surface-container-high hover:text-primary hover:border-primary/30 transition-all focus:outline-none shadow-sm"
              >
                查看详细设置
              </button>
            </div>
          </div>

          <!-- Recent Activity Card -->
          <div
            class="bg-surface-container-low rounded-xl p-6 shadow-lg border border-outline-variant/5"
          >
            <h4
              class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-label mb-4"
            >
              最近活动
            </h4>
            <div class="space-y-5">
              <div class="flex gap-3 group">
                <div
                  class="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shadow-[0_0_5px_var(--color-primary)]"
                ></div>
                <div>
                  <p
                    class="text-xs text-on-surface leading-snug group-hover:text-primary/90 transition-colors"
                  >
                    <b class="text-primary font-semibold">Sarah L.</b> 上传了 4
                    份新技术规格书。
                  </p>
                  <p
                    class="text-[10px] text-on-surface-variant mt-1 uppercase font-mono"
                  >
                    14 分钟前
                  </p>
                </div>
              </div>
              <div class="flex gap-3 group">
                <div
                  class="w-1.5 h-1.5 rounded-full bg-secondary mt-1.5 shadow-[0_0_5px_var(--color-secondary)]"
                ></div>
                <div>
                  <p
                    class="text-xs text-on-surface leading-snug group-hover:text-secondary/90 transition-colors"
                  >
                    系统已成功重新索引
                    <b class="font-semibold text-secondary">Neural_Core</b>。
                  </p>
                  <p
                    class="text-[10px] text-on-surface-variant mt-1 uppercase font-mono"
                  >
                    2 小时前
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped></style>
