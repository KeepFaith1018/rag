<script setup lang="ts">
import { computed } from 'vue'

// 定义按钮组件的属性类型
interface Props {
  variant?: 'primary' | 'outline' | 'ghost'
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  class?: string
}

// 设置默认值
const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  type: 'button',
  disabled: false,
  class: ''
})

// 根据 variant 计算对应的 Tailwind 样式类
const variantClasses = computed(() => {
  switch (props.variant) {
    case 'primary':
      // 品牌主色背景，高亮文字
      return 'bg-primary-container text-on-primary-container border-transparent hover:brightness-110'
    case 'outline':
      // 透明背景，边框线，hover 时稍微提亮背景
      return 'bg-transparent border border-outline-variant/30 text-on-surface hover:bg-surface-container-high'
    case 'ghost':
      // 无边框，无背景，仅 hover 时有底色
      return 'bg-transparent border-transparent text-on-surface hover:bg-surface-container-high'
    default:
      return ''
  }
})
</script>

<template>
  <!-- 
    通用样式说明：
    - font-headline, font-medium: 统一采用 Space Grotesk 字体，保持工程感
    - transition-all duration-200: 所有状态变化都带有 0.2s 的平滑过渡
    - active:scale-[0.98]: 模拟物理按压的精密仪器手感
  -->
  <button
    :type="type"
    :disabled="disabled"
    :class="[
      'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-headline font-medium',
      'transition-all duration-200 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-primary/40',
      disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer',
      variantClasses,
      props.class
    ]"
  >
    <!-- 提供插槽以支持自定义图标或复杂文本 -->
    <slot></slot>
  </button>
</template>
