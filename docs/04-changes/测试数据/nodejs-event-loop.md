# Node.js 事件循环与性能优化

## 事件循环架构

Node.js 基于 libuv 库实现事件循环，采用单线程、非阻塞 I/O 模型。事件循环包含 6 个阶段，按固定顺序循环执行。

### 六个阶段

| 阶段 | 职责 |
|------|------|
| **Timers** | 执行 setTimeout / setInterval 到期回调 |
| **Pending Callbacks** | 处理系统操作回调（如 TCP 错误） |
| **Idle, Prepare** | 内部使用 |
| **Poll** | 获取新的 I/O 事件并执行回调 |
| **Check** | 执行 setImmediate() 回调 |
| **Close Callbacks** | 执行 close 事件回调（如 socket.close） |

## 微任务 vs 宏任务

### 分类

| 类型 | API | 执行时机 |
|------|-----|---------|
| **微任务**（高优先级） | process.nextTick()、Promise.then/catch/finally、queueMicrotask() | 当前阶段结束后立即清空整个微任务队列 |
| **宏任务**（低优先级） | setTimeout、setInterval、setImmediate、I/O 操作 | 每轮事件循环中执行一个 |

### 执行顺序示例

```javascript
console.log('Start');

setTimeout(() => console.log('Timeout'), 0);      // 宏任务
Promise.resolve().then(() => console.log('Promise')); // 微任务
process.nextTick(() => console.log('Next Tick')); // 微任务（最高优先级）
setImmediate(() => console.log('Immediate'));     // 宏任务

console.log('End');

// 输出: Start → End → Next Tick → Promise → Timeout(或Immediate) → Immediate(或Timeout)
```

> process.nextTick() 优先级高于 Promise，nextTick 队列在当前操作完成后立即执行，而 Promise 在 nextTick 之后。

## 性能优化最佳实践

### 1. 避免阻塞事件循环

长耗时同步操作会阻塞整个事件循环：

```javascript
// 错误：阻塞主线程
let result = largeArray.sort().filter().map();

// 正确：用 setImmediate 分片处理
function processInChunks(array, chunkSize, callback) {
  let i = 0;
  function next() {
    const chunk = array.slice(i, i + chunkSize);
    callback(chunk);
    i += chunkSize;
    if (i < array.length) {
      setImmediate(next); // 让出控制权
    }
  }
  next();
}
```

### 2. 防止微任务饥饿（Microtask Starvation）

微任务队列会持续清空才进入下一个宏任务。如果微任务中不断产生新微任务，会导致 I/O 和定时器回调永远得不到执行：

```javascript
// 危险：微任务递归，永不停止
function riskyRecursion() {
  Promise.resolve().then(() => {
    doWork();
    riskyRecursion(); // ❌ 阻塞所有宏任务
  });
}

// 安全：用 setImmediate 定期让出
function safeRecursion(count = 0) {
  doWork();
  if (count < 100) {
    setImmediate(() => safeRecursion(count + 1)); // 正确
  }
}
```

### 3. CPU 密集型任务使用 Worker Threads

```javascript
// 主线程
const { Worker } = require('worker_threads');
const worker = new Worker('./worker.js');
worker.postMessage({ data: 10000 });
worker.on('message', (result) => console.log(result));

// worker.js
const { parentPort } = require('worker_threads');
parentPort.on('message', ({ data }) => {
  const result = heavyCalculation(data);
  parentPort.postMessage(result);
});
```

### 4. 监控事件循环延迟

```javascript
const { performance } = require('perf_hooks');

function measureEventLoopDelay() {
  const start = performance.now();
  setImmediate(() => {
    const delay = performance.now() - start;
    if (delay > 10) {
      console.warn(`Event Loop 高延迟: ${delay.toFixed(2)}ms`);
    }
  });
}

setInterval(measureEventLoopDelay, 1000);
```

### 5. 任务优先级选择指南

| 场景 | 推荐 |
|------|------|
| 需要立即执行的清理/状态更新 | process.nextTick() |
| 高优先级异步操作 | Promise.then() / queueMicrotask() |
| 可延迟的非关键逻辑 | setImmediate() |
| 低优先级后台任务 | setTimeout(fn, 0) |
| CPU 密集型计算 | Worker Threads |

### 6. 使用异步 I/O

```javascript
// 错误：同步 I/O 阻塞
const data = fs.readFileSync('file.txt', 'utf8');

// 正确：异步 I/O
const fs = require('fs').promises;
const data = await fs.readFile('file.txt', 'utf8');
```

### 7. 并发请求优化

```javascript
// 使用 Promise.all 并发请求
const [user, posts, comments] = await Promise.all([
  fetch('/api/user').then(r => r.json()),
  fetch('/api/posts').then(r => r.json()),
  fetch('/api/comments').then(r => r.json()),
]);
```

## 关键总结

1. 微任务优先于宏任务 — 每次宏任务结束后微任务队列被完全清空
2. 避免微任务递归 — 会导致 I/O 饥饿和服务挂起
3. 拆分长任务 — 使用 setImmediate() 分片或 Worker Threads
4. 优先异步 API — fs.promises、async/await、Promise.all
5. 监控为关键 — 使用 perf_hooks 定位延迟瓶颈
