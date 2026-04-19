<script setup lang="ts">
// 定义输入框组件属性
interface Props {
  modelValue?: string | number
  type?: string
  placeholder?: string
  id?: string
  disabled?: boolean
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  type: 'text',
  placeholder: '',
  disabled: false,
  class: ''
})

// Vue 3.3+ 支持的 defineModel，用于简化双向绑定
const model = defineModel<string | number>()
</script>

<template>
  <div class="relative w-full group">
    <!-- 
      输入框主体样式说明：
      - bg-surface-container-highest: 使用最高层级的背景色，与画布区分
      - border-outline-variant/20: 默认只提供极微弱的“Ghost Border”辅助线
      - focus:border-primary: 聚焦时边框点亮为电光靛蓝
    -->
    <input
      :id="id"
      :type="type"
      v-model="model"
      :placeholder="placeholder"
      :disabled="disabled"
      :class="[
        'w-full bg-surface-container-highest border border-outline-variant/20 rounded-lg',
        'px-4 py-3 text-sm text-on-surface placeholder:text-outline/40',
        'focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50',
        'transition-all duration-200',
        disabled ? 'opacity-50 cursor-not-allowed' : '',
        props.class
      ]"
    />
    
    <!-- 提供右侧图标插槽（如：搜索图标、密码可见切换图标） -->
    <div v-if="$slots.icon" class="absolute inset-y-0 right-3 flex items-center text-outline/60 group-focus-within:text-primary transition-colors">
      <slot name="icon"></slot>
    </div>
  </div>
</template>
