<script setup lang="ts">
// 卡片组件的基础属性
interface Props {
  hoverable?: boolean
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  hoverable: false,
  class: ''
})
</script>

<template>
  <!--
    卡片样式设计哲学 (Bento 风格)：
    - bg-surface-container-low: 基础色使用偏暗的容器底色
    - hover:bg-surface-container-high: 拒绝生硬边框，通过背景色的提亮来表现悬浮状态
    - hover:border-outline-variant/10: 极其隐约的边框反馈
  -->
  <div
    :class="[
      'bg-surface-container-low rounded-xl p-6 border border-transparent',
      'transition-all duration-300 ease-out',
      hoverable ? 'cursor-pointer hover:bg-surface-container-high hover:border-outline-variant/10 hover:-translate-y-1 hover:shadow-lg' : '',
      props.class
    ]"
  >
    <!-- 提供不同部分的具名插槽，支持复杂卡片布局 -->
    <div v-if="$slots.header" class="mb-4">
      <slot name="header"></slot>
    </div>
    
    <div class="flex-1">
      <slot></slot>
    </div>

    <div v-if="$slots.footer" class="mt-4 pt-4 border-t border-outline-variant/10">
      <slot name="footer"></slot>
    </div>
  </div>
</template>
