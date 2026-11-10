import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import {
  ErrorCode,
  WS_CLOSE,
  WS_HEARTBEAT_MS,
  WS_MAX_MESSAGE_BYTES,
  can,
  parseRoomName,
  type BoardEventMessage,
} from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { AppError } from '../../lib/app-error.js';
import { onBoardEvent } from '../../lib/board-events.js';
import { onMembershipChange } from '../../lib/membership-events.js';
import { getSessionFromCookieHeader } from '../auth/session.js';
import { authorize, type ResourceRef } from '../authz/index.js';
import { RoomManager, noPersistence, type Connection, type RoomPersistence } from './rooms.js';

export interface RealtimeOptions {
  /** Document persistence hook (KB-017). Defaults to none (in-memory only). */
  persistence?: RoomPersistence;
  /** Ping interval in milliseconds. Defaults to 30 s; tests shorten it. */
  heartbeatMs?: number;
}

/** What other modules can do with the real-time layer. */
export interface RealtimeService {
  /** Pushes a board event to every client of the board room (KB-018). */
  broadcastBoardEvent(boardId: string, event: BoardEventMessage): void;
  readonly rooms: RoomManager;
  /** Flushes pending document batches and closes every socket with 1012 (SIGTERM/SIGINT). */
  shutdown(): Promise<void>;
}

declare module 'fastify' {
  interface FastifyInstance {
    realtime: RealtimeService;
  }
}

/** Largest number of messages buffered while the upgrade is still being authorized. */
const MAX_PENDING_MESSAGES = 200;

const toBytes = (raw: RawData): Uint8Array => {
  if (Array.isArray(raw)) return new Uint8Array(Buffer.concat(raw));
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
};

/** Creates the real-time service; `buildApp` decorates the root instance with it (`app.realtime`). */
export function createRealtime(options: RealtimeOptions = {}): RealtimeService {
  const rooms = new RoomManager(options.persistence ?? noPersistence);
  return {
    rooms,
    shutdown: () => rooms.shutdown(),
    broadcastBoardEvent: (boardId, event) => rooms.broadcastBoardEvent(boardId, event),
  };
}

export function realtimeRoutes({
  prisma,
  webOrigin,
  realtime,
  options = {},
}: {
  prisma: PrismaClient;
  /** Normalised allowed origin. */
  webOrigin: string;
  realtime: RealtimeService;
  options?: RealtimeOptions;
}) {
  return async (app: FastifyInstance): Promise<void> => {
    const rooms = realtime.rooms;

    await app.register(websocket, { options: { maxPayload: WS_MAX_MESSAGE_BYTES } });

    // Membership changes (KB-009) close or re-authorize the user's open sockets immediately.
    const unsubscribe = onMembershipChange(({ workspaceId, userId, role }) => {
      for (const conn of rooms.connectionsOf(userId, workspaceId)) {
        if (role === null) {
          conn.socket.close(WS_CLOSE.forbidden, 'Membership removed');
        } else {
          conn.role = role;
        }
      }
    });

    // Committed board changes (KB-018) go to every connection of the board room, viewers included.
    // Only members of the workspace can be in the room (authorized at connect, closed on removal).
    const unsubscribeBoard = onBoardEvent((event) => {
      realtime.broadcastBoardEvent(event.boardId, { type: event.type, data: event });
    });

    // Heartbeat: ping every interval; a socket that did not answer the previous ping is terminated.
    const alive = new WeakMap<WebSocket, boolean>();
    const sockets = new Set<WebSocket>();
    const timer = setInterval(() => {
      for (const socket of sockets) {
        if (alive.get(socket) === false) {
          socket.terminate();
          continue;
        }
        alive.set(socket, false);
        socket.ping();
      }
    }, options.heartbeatMs ?? WS_HEARTBEAT_MS);
    timer.unref();

    app.addHook('onClose', async () => {
      clearInterval(timer);
      unsubscribe();
      unsubscribeBoard();
      await rooms.shutdown();
    });

    app.get(
      '/ws/:room',
      {
        websocket: true,
        // Runs before the upgrade: a browser always sends Origin; anything else is not our web app
        // (cross-site WebSocket hijacking, A3). Authentication happens after the upgrade (4401).
        preValidation: async (req) => {
          if (req.headers.origin !== webOrigin) {
            throw new AppError(403, ErrorCode.CSRF_REJECTED, 'Request origin not allowed');
          }
        },
      },
      (socket, req) => {
        sockets.add(socket);
        alive.set(socket, true);
        socket.on('pong', () => alive.set(socket, true));
        socket.on('error', () => {});

        const pending: Uint8Array[] = [];
        let conn: Connection | null = null;
        let open = false;

        const process = (data: Uint8Array): void => {
          if (!conn) return;
          try {
            rooms.handleMessage(conn, data);
          } catch {
            socket.close(1007, 'Malformed message');
          }
        };

        // Listen at once: messages sent right after the upgrade wait for authorization.
        socket.on('message', (raw, isBinary) => {
          if (!isBinary) {
            socket.close(1003, 'Binary messages only');
            return;
          }
          if (open) {
            process(toBytes(raw));
          } else if (pending.length >= MAX_PENDING_MESSAGES) {
            socket.close(1008, 'Too many messages before the room is ready');
          } else {
            pending.push(toBytes(raw));
          }
        });

        socket.on('close', () => {
          sockets.delete(socket);
          if (conn) void rooms.leave(conn);
        });

        void (async () => {
          try {
            const session = await getSessionFromCookieHeader(prisma, req.headers.cookie);
            if (!session) {
              socket.close(WS_CLOSE.unauthenticated, 'Authentication required');
              return;
            }
            const ref = parseRoomName((req.params as { room: string }).room);
            if (!ref) {
              socket.close(WS_CLOSE.invalidRoom, 'Invalid room');
              return;
            }
            const resource: ResourceRef =
              ref.type === 'board' ? { type: 'board', id: ref.id } : { type: 'card', id: ref.id };
            let ctx;
            try {
              ctx = await authorize(prisma, session.user, resource, 'workspace:read');
            } catch (err) {
              if (err instanceof AppError && (err.statusCode === 404 || err.statusCode === 403)) {
                // Missing room and non-member look the same.
                socket.close(WS_CLOSE.forbidden, 'Forbidden');
                return;
              }
              throw err;
            }
            if (!can(ctx.role, 'workspace:read') || socket.readyState !== socket.OPEN) {
              socket.close(WS_CLOSE.forbidden, 'Forbidden');
              return;
            }
            const joining: Connection = {
              socket,
              userId: session.user.id,
              workspaceId: ctx.workspaceId,
              role: ctx.role,
              awarenessIds: new Set(),
              room: null,
            };
            conn = joining;
            if (!(await rooms.join(ref, joining))) return;
            open = true;
            for (const data of pending.splice(0)) process(data);
          } catch (err) {
            req.log.error({ err }, 'websocket setup failed');
            socket.close(1011, 'Internal error');
          }
        })();
      },
    );
  };
}
