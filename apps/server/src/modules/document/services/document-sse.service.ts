import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Observable, Subject } from 'rxjs';

interface DocumentStateChangedPayload {
  kbId: string;
  documentId: string;
  status: string;
  currentStage: string;
  processingVersion: number;
}

/**
 * 管理 SSE 客户端订阅，将内部文档状态变更事件广播到对应知识库的订阅者。
 */
@Injectable()
export class DocumentSseService implements OnModuleDestroy {
  private readonly streams = new Map<string, Set<Subject<MessageEvent>>>();
  private readonly pingIntervals = new Map<Subject<MessageEvent>, ReturnType<typeof setInterval>>();

  private static readonly PING_INTERVAL_MS = 30_000;

  /**
   * 为指定知识库创建 SSE 可观察流。
   */
  
  subscribe(kbId: string): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();
    const kbStreams = this.getOrCreateKbStreams(kbId);
    kbStreams.add(subject);

    // 心跳保活，防止代理 / 负载均衡超时断开
    const pingInterval = setInterval(() => {
      if (!subject.closed) {
        subject.next({ data: JSON.stringify({ type: 'ping' }) } as MessageEvent);
      }
    }, DocumentSseService.PING_INTERVAL_MS);
    this.pingIntervals.set(subject, pingInterval);

    subject.next({
      data: JSON.stringify({ type: 'connected', kbId }),
    } as MessageEvent);

    const observable = new Observable<MessageEvent>((observer) => {
      const subscription = subject.subscribe(observer);
      return () => {
        this.unsubscribe(kbId, subject);
        subscription.unsubscribe();
      };
    });

    return observable;
  }

  /**
   * 监听文档状态变更事件并广播到相应知识库的订阅者。
   */
  @OnEvent('document.state.changed')
  handleDocumentStateChanged(payload: DocumentStateChangedPayload) {
    const kbStreams = this.streams.get(payload.kbId);
    if (!kbStreams || kbStreams.size === 0) {
      return;
    }

    const message = {
      data: JSON.stringify({
        type: 'document.state.changed',
        ...payload,
      }),
    } as MessageEvent;

    for (const subject of kbStreams) {
      if (!subject.closed) {
        subject.next(message);
      }
    }
  }

  /**
   * 当客户端断开连接时清理 Subject。
   */
  private unsubscribe(kbId: string, subject: Subject<MessageEvent>) {
    const pingInterval = this.pingIntervals.get(subject);
    if (pingInterval !== undefined) {
      clearInterval(pingInterval);
      this.pingIntervals.delete(subject);
    }

    const kbStreams = this.streams.get(kbId);
    if (!kbStreams) {
      return;
    }

    kbStreams.delete(subject);
    subject.complete();

    if (kbStreams.size === 0) {
      this.streams.delete(kbId);
    }
  }

  onModuleDestroy() {
    for (const [, kbStreams] of this.streams) {
      for (const subject of kbStreams) {
        subject.complete();
      }
    }
    this.streams.clear();
    for (const interval of this.pingIntervals.values()) {
      clearInterval(interval);
    }
    this.pingIntervals.clear();
  }

  private getOrCreateKbStreams(kbId: string) {
    const existing = this.streams.get(kbId);
    if (existing) {
      return existing;
    }
    const newSet = new Set<Subject<MessageEvent>>();
    this.streams.set(kbId, newSet);
    return newSet;
  }
}
