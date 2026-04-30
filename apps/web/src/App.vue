<script setup lang="ts">
import { RouterView } from "vue-router";
import AppMessageContainer from "@/components/ui/AppMessageContainer.vue";
</script>

<template>
  <!-- 路由渲染出口 -->
  <RouterView />
  <AppMessageContainer />
</template>
