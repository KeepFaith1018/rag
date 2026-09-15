import { Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { RuntimeConfig } from '../../../platform/config/runtime-config.service';
import { ProcessingPubSubService } from '../../../platform/queue/pubsub.service';
import { processingChannel } from '../contracts/identifiers';
import { BusinessError } from '../../../shared/errors/business-error';
import { ErrorCode } from '../../../shared/errors/error-code';
import {
  ProcessingChangedEventSchema,
  parseVersioned,
} from '../contracts/schemas';

@Injectable()
export class ProcessingEventsService {
  private instanceConnections = 0;
  private readonly userConnections = new Map<string, number>();

  constructor(
    private readonly pubsub: ProcessingPubSubService,
    private readonly runtime: RuntimeConfig,
  ) {}

  stream(
    kbId: bigint,
    userId: string,
    tokenExpiresAt: number,
    revalidate: () => Promise<void>,
  ) {
    const settings = this.runtime.processingSse;
    const userCount = this.userConnections.get(userId) ?? 0;
    if (
      this.instanceConnections >= settings.instanceLimit ||
      userCount >= settings.perUserLimit
    ) {
      throw new BusinessError(
        ErrorCode.RATE_LIMITED,
        '处理状态连接数已达上限',
        'rate-limit',
      );
    }
    const lifetimeMs = Math.min(
      settings.maxDurationSeconds * 1000,
      tokenExpiresAt - Date.now(),
    );
    if (lifetimeMs <= 0)
      throw new BusinessError(
        ErrorCode.UNAUTHORIZED_EXPIRED,
        '登录状态已过期',
        'unauthenticated',
      );
    this.instanceConnections++;
    this.userConnections.set(userId, userCount + 1);
    const channel = processingChannel(
      this.runtime.queue.processingChannelPrefix,
      kbId,
    );
    return new Observable<MessageEvent>((subscriber) => {
      let unsubscribe: (() => Promise<void>) | undefined;
      let checking = false;
      const heartbeat = setInterval(() => {
        if (checking) return;
        checking = true;
        void revalidate()
          .then(() =>
            subscriber.next({ type: 'heartbeat', data: '' } as MessageEvent),
          )
          .catch(() => subscriber.complete())
          .finally(() => {
            checking = false;
          });
      }, settings.heartbeatMs);
      const maximumLifetime = setTimeout(
        () => subscriber.complete(),
        lifetimeMs,
      );
      void this.pubsub
        .subscribe(channel, (message) => {
          try {
            const event = parseVersioned(
              ProcessingChangedEventSchema,
              JSON.parse(message),
            );
            subscriber.next({
              type: event.eventType,
              data: event,
            } as MessageEvent);
          } catch (error) {
            // 未知顶层版本必须断开；损坏消息丢弃，权威状态仍由 REST 快照恢复。
            if (
              error instanceof Error &&
              error.message === 'SCHEMA_VERSION_UNSUPPORTED'
            )
              subscriber.complete();
          }
        })
        .then((cleanup) => {
          unsubscribe = cleanup;
        })
        .catch((error) => subscriber.error(error));
      return () => {
        clearInterval(heartbeat);
        clearTimeout(maximumLifetime);
        if (unsubscribe) void unsubscribe();
        this.instanceConnections = Math.max(0, this.instanceConnections - 1);
        const current = this.userConnections.get(userId) ?? 1;
        if (current <= 1) this.userConnections.delete(userId);
        else this.userConnections.set(userId, current - 1);
      };
    });
  }
}
