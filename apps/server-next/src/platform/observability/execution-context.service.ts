import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 一次请求或后台任务的关联标识。
 * 字段保持可选，使同一上下文容器可同时服务 HTTP 进程和 Worker 进程。
 */
export interface ExecutionMetadata {
  requestId?: string;
  runId?: string;
  taskId?: string;
}

/**
 * 基于 AsyncLocalStorage 的执行上下文容器。
 *
 * 下游代码无需显式层层传递 requestId/runId/taskId，AppLogger 在写日志时可直接读取当前
 * 异步调用链的关联信息。
 */
@Injectable()
export class ExecutionContextStore {
  private readonly storage = new AsyncLocalStorage<ExecutionMetadata>();

  /**
   * 在指定元数据上下文内执行回调；异步资源会继承该上下文。
   */
  run<T>(metadata: ExecutionMetadata, callback: () => T): T {
    return this.storage.run(metadata, callback);
  }

  /**
   * 获取当前上下文。非请求或尚未绑定上下文时返回空对象，方便日志调用方无条件合并。
   */
  get(): ExecutionMetadata {
    return this.storage.getStore() ?? {};
  }
}
