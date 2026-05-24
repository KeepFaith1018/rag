# Vue 3 Composition API 完整指南

## 概述

Vue 3 的 Composition API（组合式 API）是一组基于函数的 API，允许开发者使用导入的函数来描述组件逻辑。它是 Vue 3 的核心特性之一，与传统的 Options API 并存，提供了更灵活的代码组织方式。

## setup() 函数

`setup()` 是组合式 API 的入口点，在 `beforeCreate` 和 `created` 生命周期之间执行。它接收两个参数：`props`（响应式）和 `context`（包含 attrs、emit、slots 等）。

### 基本写法

```javascript
import { ref } from 'vue'

export default {
  setup() {
    const count = ref(0)
    const increase = () => count.value++
    return { count, increase }
  }
}
```

### script setup 语法糖（推荐）

```vue
<script setup>
import { ref } from 'vue'
const count = ref(0)
const increase = () => count.value++
</script>
```

script setup 的优势：
- 自动暴露顶层变量给模板
- 更少的样板代码
- 更好的 TypeScript 支持
- 编译时优化

## 响应式核心 API

### ref() — 基本类型响应式

`ref()` 接收一个值并返回一个响应式 Ref 对象。在 JS 中需要通过 `.value` 访问，在模板中自动解包。

```javascript
const count = ref(0)
const message = ref('Hello')
const isActive = ref(true)

// JS 中操作
count.value++
message.value = 'World'
```

ref 也可以包裹对象类型，内部会调用 `reactive()` 处理。

### reactive() — 对象响应式

`reactive()` 接收一个普通对象，返回其深层响应式代理（基于 ES6 Proxy）。

```javascript
const state = reactive({
  user: { name: 'Alice', age: 25 },
  items: ['apple', 'banana']
})

// 直接修改属性即可触发更新
state.user.name = 'Bob'
state.items.push('cherry')
```

注意事项：
- 解构会失去响应性，使用 `toRefs()` 保持响应性
- 不能替换整个对象（`state = {...}` 无效）
- 只对对象类型有效

### computed() — 计算属性

接收一个 getter 函数，返回只读的 ref 对象，自动缓存计算结果。

```javascript
const count = ref(1)
const doubleCount = computed(() => count.value * 2)

// 可写计算属性
const fullName = computed({
  get: () => firstName.value + ' ' + lastName.value,
  set: (val) => {
    [firstName.value, lastName.value] = val.split(' ')
  }
})
```

计算属性只在依赖变化时才重新计算，性能优于 methods。

### watch() — 侦听器

惰性执行，仅在数据源变化时才执行回调。可获取新旧值。

```javascript
// 监听 ref
watch(count, (newVal, oldVal) => {
  console.log(`从 ${oldVal} 变为 ${newVal}`)
})

// 监听多个源
watch([count, name], ([newCount, newName], [oldCount, oldName]) => {
  // ...
})

// 监听 reactive 对象的属性（getter）
watch(() => state.user.name, (newName) => {
  console.log('名字变了:', newName)
})

// 配置选项
watch(source, callback, {
  immediate: true,  // 立即执行一次
  deep: true,       // 深度监听
  flush: 'post'     // DOM 更新后执行
})
```

### watchEffect() — 自动追踪副作用

立即执行，自动追踪其回调中访问的所有响应式依赖。

```javascript
const stop = watchEffect(() => {
  // 自动追踪 count 和 name
  console.log(`${name.value}: ${count.value}`)
})
// stop() 可手动停止
```

## watch vs watchEffect vs computed

| 特性 | computed | watch | watchEffect |
|------|----------|-------|-------------|
| 用途 | 派生新值 | 响应变化执行副作用 | 自动追踪副作用 |
| 缓存 | 是 | 否 | 否 |
| 获取新旧值 | 否 | 是 | 否 |
| 立即执行 | 否 | 需 immediate | 是（默认立即） |
| 典型场景 | 模板渲染、过滤 | API 请求、路由跳转 | 调试、DOM 操作 |

## 生命周期钩子

Composition API 中的生命周期钩子以 `on` 为前缀：

```javascript
import { onMounted, onUnmounted, onUpdated } from 'vue'

setup() {
  onMounted(() => console.log('组件已挂载'))
  onUnmounted(() => console.log('组件已卸载'))
  onUpdated(() => console.log('DOM 已更新'))
}
```

## 组合函数（Composables）

组合式 API 的最大价值在于可以抽取可复用的逻辑：

```javascript
// useCounter.js
export function useCounter(initialValue = 0) {
  const count = ref(initialValue)
  const increment = () => count.value++
  const decrement = () => count.value--
  return { count, increment, decrement }
}

// 在组件中使用
const { count, increment } = useCounter(10)
```

## 与 Options API 的对比

| 场景 | Options API | Composition API |
|------|-------------|-----------------|
| 逻辑复用 | Mixins（命名冲突、来源不清） | Composables（清晰、类型安全） |
| 代码组织 | 按选项类型分散（data/methods/computed） | 按功能聚合 |
| TypeScript | 需要大量类型体操 | 天然支持类型推导 |
| Tree-shaking | 不支持 | 未使用的 API 可被摇树优化 |
| 学习曲线 | 对新手友好 | 需要理解响应式原理 |

## 设计理念

Vue 3 Composition API 的核心设计理念是利用 JavaScript 的 Proxy 响应式系统，实现自动依赖追踪。与 React Hooks 不同：
- setup() 只执行一次，后续通过响应式系统精准触发更新
- 无需手动声明依赖数组
- 不受 Hooks 调用顺序限制
- 不存在"闭包陷阱"问题

这种设计使得 Vue 3 的 Composition API 在保持灵活性的同时，避免了 React Hooks 的一些常见问题。
