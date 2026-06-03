import type { Socket } from 'socket.io';
import type { ZodTypeAny, z } from 'zod';
import { logger } from '../lib/logger.js';
import { checkSocketRateLimit, type RateLimitOptions } from './rateLimiter.js';

type Ack = (response: unknown) => void;

interface HandlerOptions<TSchema extends ZodTypeAny | undefined> {
  event: string;
  schema?: TSchema;
  rateLimit?: RateLimitOptions;
}

interface HandlerContext {
  ack: Ack;
}

function noopAck(): void {}

function isAck(value: unknown): value is Ack {
  return typeof value === 'function';
}

function emitSocketError(socket: Socket, event: string, code: string, message: string): void {
  socket.emit('socket_error', { event, code, message });
}

export function onSafe<
  TSocket extends Socket,
  TSchema extends ZodTypeAny | undefined = undefined,
>(
  socket: TSocket,
  options: HandlerOptions<TSchema>,
  handler: (
    payload: TSchema extends ZodTypeAny ? z.infer<TSchema> : undefined,
    context: HandlerContext,
  ) => Promise<void> | void,
): void {
  socket.on(options.event, (...args: unknown[]) => {
    const maybeAck = args[args.length - 1];
    const ack = isAck(maybeAck) ? maybeAck : noopAck;
    const rawPayload = isAck(maybeAck) && args.length === 1 ? undefined : args[0];

    void (async () => {
      if (options.rateLimit && !checkSocketRateLimit(socket, options.event, options.rateLimit)) {
        const response = { ok: false, error: 'Rate limit exceeded', code: 'RATE_LIMITED' };
        ack(response);
        emitSocketError(socket, options.event, response.code, response.error);
        return;
      }

      let payload: unknown = rawPayload;
      if (options.schema) {
        const parsed = options.schema.safeParse(rawPayload);
        if (!parsed.success) {
          const response = { ok: false, error: 'Invalid payload', code: 'VALIDATION_ERROR' };
          ack(response);
          emitSocketError(socket, options.event, response.code, response.error);
          logger.warn(
            {
              socketId: socket.id,
              namespace: socket.nsp.name,
              event: options.event,
              issues: parsed.error.issues,
            },
            'socket validation failed',
          );
          return;
        }
        payload = parsed.data;
      }

      try {
        await handler(payload as TSchema extends ZodTypeAny ? z.infer<TSchema> : undefined, { ack });
      } catch (err) {
        logger.error(
          {
            err,
            socketId: socket.id,
            namespace: socket.nsp.name,
            event: options.event,
            userId: (socket.data as { user?: { userId?: string } }).user?.userId,
          },
          'socket handler failed',
        );
        const response = { ok: false, error: 'Internal error', code: 'INTERNAL_ERROR' };
        ack(response);
        emitSocketError(socket, options.event, response.code, response.error);
      }
    })();
  });
}
