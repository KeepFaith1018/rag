# Vue 3 Options API 完整参考

## 概述

Options API 是 Vue 的传统组件编写方式，通过 `data`、`methods`、`computed`、`watch`、生命周期钩子等选项来组织组件逻辑。在 Vue 3 中与 Composition API 并存，仍然是完全支持的一等公民。

## data（响应式数据）

`data` 必须是一个返回对象的函数，以确保每个组件实例拥有独立的数据副本。

```javascript
export default {
  data() {
    return {
      count: 0,
      message: 'Hello Vue 3',
      user: { name: 'Alice', age: 25 }
    }
  }
}
```

## methods（方法）

定义组件的业务逻辑方法，可在模板中作为事件处理器绑定。

```javascript
export default {
  data() {
    return { count: 0 }
  },
  methods: {
    increment() { this.count++ },
    decrement() { this.count-- },
    reset() { this.count = 0 }
  }
}
```

```html
<button @click="increment">+1</button>
<button @click="reset">重置</button>
```

## computed（计算属性）

基于响应式数据派生新值，结果会被自动缓存，依赖不变时不重新计算。

```javascript
export default {
  data() {
    return {
      price: 100,
      quantity: 2,
      firstName: 'Zhang',
      lastName: 'San'
    }
  },
  computed: {
    total() {
      return this.price * this.quantity
    },
    fullName: {
      get() { return this.firstName + ' ' + this.lastName },
      set(val) {
        [this.firstName, this.lastName] = val.split(' ')
      }
    }
  }
}
```

## watch（侦听器）

用于监听响应式数据的变化并执行副作用。

```javascript
export default {
  data() {
    return { count: 0, searchText: '' }
  },
  watch: {
    count(newVal, oldVal) {
      console.log(`count: ${oldVal} → ${newVal}`)
    },
    searchText: {
      handler(newVal) {
        this.search(newVal)
      },
      immediate: true,  // 立即执行
      deep: true        // 深度监听
    }
  }
}
```

## 生命周期钩子

按执行顺序排列的所有 Options API 生命周期钩子：

| 钩子 | 触发时机 |
|------|---------|
| beforeCreate | 实例初始化后，data 和 computed 处理之前 |
| created | 实例创建完成，响应式系统已就绪，但未挂载 DOM |
| beforeMount | 挂载开始前，render 函数即将首次调用 |
| mounted | 组件挂载到 DOM 后，可通过 this.$el 访问 |
| beforeUpdate | 数据变化导致 DOM 重新渲染前 |
| updated | 数据变化导致 DOM 重新渲染后 |
| beforeUnmount | 组件卸载前，实例仍完全可用 |
| unmounted | 组件卸载后，事件监听、定时器应在此清理 |
| errorCaptured | 捕获到后代组件错误时 |
| activated | KeepAlive 缓存组件被激活时 |
| deactivated | KeepAlive 缓存组件被停用时 |

```javascript
export default {
  beforeCreate()  { /* 实例初始化 */ },
  created()       { /* 数据获取、事件监听 */ },
  mounted()       { /* DOM 操作、第三方库初始化 */ },
  beforeUnmount() { /* 清理准备 */ },
  unmounted()     { /* 清理定时器、取消订阅 */ }
}
```

## 组件通信

### Props（父传子）

```javascript
export default {
  props: {
    title: { type: String, required: true },
    count: { type: Number, default: 0 }
  }
}
```

### Emit（子传父）

```javascript
export default {
  emits: ['update', 'delete'],
  methods: {
    handleClick() {
      this.$emit('update', { id: 1 })
    }
  }
}
```

### Provide / Inject（跨层级）

```javascript
// 祖先组件
export default {
  provide() {
    return { theme: 'dark', locale: 'zh-CN' }
  }
}

// 后代组件
export default {
  inject: ['theme', 'locale']
}
```

## Mixins（逻辑复用）

```javascript
const paginationMixin = {
  data() { return { page: 1, pageSize: 10 } },
  methods: {
    nextPage() { this.page++ },
    prevPage() { this.page-- }
  }
}

export default {
  mixins: [paginationMixin],
  // 可覆盖 mixin 中的选项
  data() { return { pageSize: 20 } }
}
```

Mixins 的缺点：
- 命名冲突风险
- 来源不透明
- 多个 mixins 间的依赖关系难以追溯

> Vue 3 推荐使用 Composition API 的 Composables 替代 Mixins。

## 完整示例

```vue
<template>
  <div>
    <h1>{{ title }}</h1>
    <p>计数: {{ count }}</p>
    <p>双倍: {{ doubleCount }}</p>
    <button @click="increment">+1</button>
  </div>
</template>

<script>
export default {
  name: 'Counter',
  data() {
    return { title: '计数器', count: 0 }
  },
  computed: {
    doubleCount() { return this.count * 2 }
  },
  watch: {
    count(newVal) { document.title = `计数: ${newVal}` }
  },
  methods: {
    increment() { this.count++ }
  },
  mounted() { console.log('组件已挂载') }
}
</script>
```

## 与 Composition API 的关系

Options API 和 Composition API 在 Vue 3 中完全兼容，可以在同一组件中混合使用。对于小型组件，Options API 更简洁直观；对于大型复杂组件，Composition API 提供了更好的逻辑组织和复用能力。
