<script setup lang="ts">
import { RouterView } from "vue-router";
import AppSidebar from "@/components/layout/AppSidebar.vue";
</script>

<template>
  <div class="flex h-screen w-full bg-surface text-on-surface overflow-hidden">
    <AppSidebar />

    <main
      class="flex-1 flex flex-col md:ml-64 relative min-h-screen overflow-hidden"
    >
      <RouterView />
    </main>
  </div>
</template>

<style scoped></style>
