# React Hooks 完整指南与设计哲学

## React Hooks 概述

React Hooks 是 React 16.8 引入的函数式 API，允许在函数组件中使用状态和生命周期特性。Hooks 遵循函数式编程范式，强调不可变数据和纯函数。

## 核心 Hooks

### useState — 状态管理

```jsx
import { useState } from 'react'

function Counter() {
  const [count, setCount] = useState(0)
  const [user, setUser] = useState({ name: 'Alice', age: 25 })

  const increment = () => setCount(prev => prev + 1)
  const updateUser = () => setUser(prev => ({ ...prev, age: prev.age + 1 }))

  return <button onClick={increment}>Count: {count}</button>
}
```

关键特性：
- 返回 `[value, setter]` 元组
- 不可变更新：必须通过 setter 触发，不能直接修改
- 每次渲染都会重新执行组件函数

### useEffect — 副作用管理

```jsx
import { useEffect, useState } from 'react'

function UserProfile({ userId }) {
  const [user, setUser] = useState(null)

  useEffect(() => {
    // 副作用：获取数据
    fetch(`/api/users/${userId}`)
      .then(res => res.json())
      .then(setUser)

    // 清理函数（可选）
    return () => { /* 取消请求、清理订阅 */ }
  }, [userId]) // 依赖数组

  return <div>{user?.name}</div>
}
```

依赖数组规则：
- `[]` 空数组 — 仅在挂载时执行一次（类似 Vue 的 onMounted）
- `[a, b]` — 当 a 或 b 变化时重新执行
- 不传 — 每次渲染后都执行

### useCallback — 函数引用稳定

```jsx
const handleClick = useCallback(() => {
  setCount(c => c + 1)
}, []) // 依赖不变时保持相同引用
```

React 中每次渲染都会重新创建函数引用，`useCallback` 用于稳定引用，避免子组件不必要的重渲染。

### useMemo — 值缓存

```jsx
const expensiveValue = useMemo(() => {
  return heavyCalculation(data)
}, [data])
```

类似于 Vue 的 `computed()`，但需要手动声明依赖数组。

## 自定义 Hook（逻辑复用）

```jsx
function useCounter(initialValue = 0) {
  const [count, setCount] = useState(initialValue)
  const increment = useCallback(() => setCount(c => c + 1), [])
  const decrement = useCallback(() => setCount(c => c - 1), [])
  return { count, increment, decrement }
}

// 使用
function MyComponent() {
  const { count, increment } = useCounter(10)
  return <button onClick={increment}>{count}</button>
}
```

## Hooks 规则

1. **只能在函数组件或自定义 Hook 中调用**
2. **只能在顶层调用**（不能在条件语句、循环、嵌套函数中）
3. **必须以 `use` 开头命名**

## React Hooks vs Vue Composition API

### 执行模型（核心差异）

React 和 Vue 最大的架构差异在于执行模型：

- **React Hooks**：每次渲染 → 整个函数重新执行 → 所有 Hook 重新运行
- **Vue Composition API**：初始化时 setup() 执行一次 → 通过 Proxy 精准触发响应式更新

### 依赖追踪

- **React**：必须显式写在依赖数组中。忘记添加依赖是常见 bug。官方提供 `eslint-plugin-react-hooks` 做静态检查
- **Vue**：运行时自动追踪。`watchEffect` 和 `computed()` 自动注册依赖，不存在"漏写依赖"的问题

### 性能优化心智负担

- **React**：需要主动使用 `useCallback`、`useMemo`、`React.memo` 防止不必要的重渲染
- **Vue**：细粒度 Proxy 响应式系统自动优化，较少需要手动干预

### 调用规则限制

- **React**：严格的 Hooks 规则 — 不能在条件/循环中调用，必须在顶层按固定顺序
- **Vue**：无严格顺序限制，可在条件/循环中自由使用

## 设计哲学

React Hooks 遵循函数式编程思想：
- 强调纯函数和不可变数据
- 通过闭包保存状态
- 显式控制一切（手动依赖、手动优化）
- 追求函数式纯粹性

Vue Composition API 遵循响应式编程思想：
- 基于 Proxy 的自动依赖追踪
- 可变数据 + 自动更新
- 框架自动优化，开发者心智负担更低
- 追求简洁直观的开发体验

两种方案都能达成同样的工程目标，选择取决于团队更认同哪种哲学。但从开发者体验角度，Vue 的响应式模型天然规避了 React Hooks 中的一些常见问题（闭包陷阱、手动依赖、严格调用顺序限制等）。
