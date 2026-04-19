<script setup lang="ts">
import TopNavBar from "@/components/layout/TopNavBar.vue";
import FilterBar from "@/components/kb/FilterBar.vue";
import KbCard from "@/components/kb/KbCard.vue";
import { ref } from "vue";

const kbs = ref([
  {
    id: "1",
    name: "神经架构",
    type: "private",
    icon: "terminal",
    color: "primary",
    docsCount: "1,240",
    size: "4.2 GB",
    createdAt: "10月12日",
    users: [
      "https://lh3.googleusercontent.com/aida-public/AB6AXuDVSF4OKA978yLjfb-rsTc0XUuJx2EcgP0mUvPzufOh419aAEtxKzOarD-BzTCMjykg5lbG_rMoCQRerigMTMyO4M-2VveZBo8WlSaqb5BlQ7zYsVCZ4d2Y4VgZDEu5fNi-fu7wcdo8TahKuco24RMBo1VAbKjDwwNQ9yXjCn-xod3gQ3LgFXO3V0VkwsuEfh-xDHahto2azyMVx9WIypjxqZmm1j3rCqD2XQXfmJvV575CDiRI-zAW2Oywzr7RXDtH6CAVPecSWbjo",
      "https://lh3.googleusercontent.com/aida-public/AB6AXuABK8umcvJWmkAC_RMOD7g7F4x4iEV1qYc42mZ2MCN__tMNIs6CwAGq5r97f-g6GKWjfbORQRj2Q-kx_Km1c9AJTBToKvxrZtE7B1j8CGOLs9AMTW4v1S00D7q8juUjDLl0ufUUaEt0Th7dXE_NfWKBDrtlwKiVt7Dt0LjuqlPYfzM8Oy6gjawPgwfDXZJ7C1hO1o61IIyXXTOOaCDB07qr7_OQiLQZpIvwuQY1mJrmHxDabfVoIx6l6khFVYDD9shXYtmTl_x_uc3X",
    ],
    moreUsers: 4,
  },
  {
    id: "2",
    name: "向量动力学",
    type: "shared",
    icon: "schema",
    color: "tertiary",
    docsCount: "458",
    size: "890 MB",
    createdAt: "9月28日",
    users: [
      "https://lh3.googleusercontent.com/aida-public/AB6AXuAwIiDzImISsQYv1zgEzMtTdjzeB7gxcwXJ1besqr0m2zkEbw8XFHLzOZQBC9e87xBC4P5VmJQuQy0levLRrvF3RQnb0RXRuHGMFLr1G9vyowYOF_4AEu_U_bbOp_pSEenlEPmRn3rm22x4mdU5wvTd8kOVPTKkUXFHKgIxiPGqeGc4zQB9UC0P9uC_fqf8KNJeA407tirkrsxXoEBTezh_I6mD6CKx25nMV5Dh8XkY8H4ZrXp--pIzyQprsxzZjiTPEMSEwWLt_bSP",
    ],
    moreUsers: 12,
  },
  {
    id: "3",
    name: "历史存档 v2",
    type: "private",
    icon: "cloud_sync",
    color: "secondary",
    docsCount: "8,122",
    size: "1.2 TB",
    createdAt: "8月05日",
    users: [
      "https://lh3.googleusercontent.com/aida-public/AB6AXuC8pqW_yuuOcTRDHoGBE7raem-6toyqy_D0jaLHbJQMtDOSsu2yxOMxh2P2EEEWB4rvVYaIWm7LVUna8Le5dZPCKQPEF3AcSKD8nDnN_BWehFdT3ogCNt3einWB7fvRRsNebsAltG-TwNBL0qcHSrnbv6ohApbXNaJfJ9Prlcq_sm_4ig5x5m1pNdiFSn-WPvDr3OUQa7t2i3RHO5yFr2tEipzWq5hlBzSKov5BBHiEPY4c76qJuf0Lu2C5mXvecDWfZZc4jGeGccr7",
    ],
  },
  {
    id: "4",
    name: "量子态训练",
    type: "private",
    icon: "memory",
    color: "primary",
    docsCount: "92",
    size: "15 GB",
    createdAt: "11月02日",
    users: [
      "https://lh3.googleusercontent.com/aida-public/AB6AXuATi-kpdaIpqDVcVv4o1MnnVl1hDCsIpCIaZ43CMAtUJD6gzAMnfZ1hEbDiV9aUoDcVNTYWKPRAhzwr3IpKnIY-93hQG6zcJrshrf69KPGH-u5_M_zzOS6dSbyz9dpztidexw6ytEmyXAGMtqwefZESjGs3QTY94iGUG1eUg9j2p4zyU_bKiT_Eh9tCO0aCc9xUQSWAI4TU6UDVMGfZOxdvaxbJLSAQhkbkv2g4NJTPPQTy6YBY8E5JIIYZT91SXuo9R0SyjZ5nd3Tb",
      "https://lh3.googleusercontent.com/aida-public/AB6AXuBRhTf3nhGIlKnY1zfzXsfZZ23e6t0yxI9lnL7j_6uQUNEXGBkS-fgnNGYOvyLVVCEZwsOvZuDmdTKi-cY3bmdknTt3rprDTGQhHrZ87rzhUgch3K-r3qvij_pfXxszkXa1o-cqRfwLs9ITGSqVvPjM6aMik6c6s3oH2l2-KJ6u5EqyWn3jZhO9ydMmVQf3K6GR__Hj-lPAE-h-Zu8Hczkr_E6jAoSFk5cR3ZhtreTu-ID-VG2YhlB3a-nch6bUst_csBhvddaH3VoF",
    ],
  },
]);
</script>

<template>
  <div class="flex flex-col h-full w-full relative">
    <!-- Top Header Navigation -->
    <header
      class="flex flex-col md:flex-row md:justify-end md:items-center w-full px-6 md:px-12 py-6 sticky top-0 z-40 bg-surface/80 backdrop-blur-xl gap-4 border-b border-transparent"
    >
      <div class="flex items-center gap-6">
        <div class="relative group hidden sm:block">
          <span
            class="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline text-lg group-hover:text-primary transition-colors"
            >search</span
          >
          <input
            type="text"
            placeholder="搜索结构..."
            class="bg-surface-container-highest border border-outline-variant/15 rounded-xl pl-12 pr-6 py-2.5 w-72 focus:ring-1 focus:ring-primary focus:outline-none text-sm transition-all placeholder:text-outline/50 cursor-text"
          />
        </div>
        <button
          class="bg-primary-container text-on-primary-container px-6 py-2.5 rounded-xl flex items-center gap-2 font-medium hover:brightness-110 active:scale-95 transition-all shadow-[0_0_15px_rgba(79,70,229,0.2)]"
        >
          <span class="material-symbols-outlined text-lg">add</span>
          新建知识库
        </button>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto relative pb-20">
      <!-- Filters Section -->
      <FilterBar class="px-6 md:px-12 my-8" />

      <!-- Content Grid -->
      <section class="px-6 md:px-12 pb-20">
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
          <KbCard v-for="kb in kbs" :key="kb.id" :kb="kb" />

          <!-- Empty State / Add New Style Card -->
          <div
            class="group border-2 border-dashed border-outline-variant/20 hover:border-primary/40 p-8 rounded-xl transition-all duration-300 flex flex-col items-center justify-center h-72 cursor-pointer bg-surface/40 hover:bg-surface-container-low"
          >
            <div
              class="w-14 h-14 rounded-full bg-surface-container-high flex items-center justify-center mb-4 group-hover:scale-110 transition-transform shadow-lg"
            >
              <span
                class="material-symbols-outlined text-outline text-2xl group-hover:text-primary transition-colors"
                >add</span
              >
            </div>
            <p
              class="font-headline text-lg font-medium text-outline group-hover:text-on-surface transition-colors"
            >
              初始化新核心
            </p>
            <p
              class="text-[10px] font-label text-outline/60 uppercase tracking-widest mt-2"
            >
              准备部署
            </p>
          </div>
        </div>
      </section>
    </div>

    <!-- Aesthetic Grid Overlay Footer -->
    <footer
      class="absolute bottom-0 left-0 w-full h-12 flex items-center px-12 justify-between border-t border-outline-variant/5 bg-surface/50 backdrop-blur-md"
    >
      <div class="flex gap-8">
        <span
          class="text-[10px] font-label tracking-tighter text-outline uppercase"
          >系统负载: 24%</span
        >
        <span
          class="text-[10px] font-label tracking-tighter text-outline uppercase"
          >活跃节点: (8)</span
        >
      </div>
      <div class="flex gap-4 items-center">
        <span
          class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shadow-[0_0_5px_#c3c0ff]"
        ></span>
        <span
          class="text-[10px] font-label tracking-tighter text-outline uppercase"
          >流同步: 稳定</span
        >
      </div>
    </footer>
  </div>
</template>

<style scoped></style>
