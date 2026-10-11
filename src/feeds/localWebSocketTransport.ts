import WebSocket, { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import { validateIso8601UtcTimestamp } from '../canonical/domain.js';
import {
  RawMarketDataMessage,
  MarketFeedHandler,
  FeedIngestionResult
} from './feedHandler.js';

export type WebSocketTransportState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'CLOSED';

export interface UnrecoverableGapReport {
  venue_id: string;
  raw_symbol: string;
  expected_sequence: string;
  received_sequence: string;
  gap_size: number;
  reason: string;
  reported_at_utc: string;
}

export interface ReplayRequestFrame {
  type: 'REPLAY_REQUEST';
  venue_id: string;
  raw_symbol: string;
  from_sequence: string;
  to_sequence: string;
}

export interface ReplayResponseFrame {
  type: 'REPLAY_RESPONSE';
  venue_id: string;
  raw_symbol: string;
  messages: RawMarketDataMessage[];
}

export interface ReplayErrorFrame {
  type: 'REPLAY_ERROR';
  venue_id: string;
  raw_symbol: string;
  from_sequence: string;
  to_sequence: string;
  reason: string;
}

export interface TickFrame {
  type: 'TICK';
  message: RawMarketDataMessage;
}

export type WebSocketWireFrame =
  | TickFrame
  | ReplayRequestFrame
  | ReplayResponseFrame
  | ReplayErrorFrame;

/** Maximum permitted WebSocket payload frame size (1 Megabyte in UTF-8 bytes) */
export const MAX_WS_FRAME_BYTES = 1024 * 1024;

/**
 * Calculates accurate UTF-8 byte length across Buffer, ArrayBuffer, Buffer arrays, and JavaScript strings.
 * Accurately prevents multibyte character overflow where string.length (UTF-16 code units) < byteLength.
 */
export function getPayloadByteLength(data: Buffer | ArrayBuffer | Buffer[] | string): number {
  if (typeof data === 'string') {
    return Buffer.byteLength(data, 'utf8');
  }
  if (Buffer.isBuffer(data)) {
    return data.byteLength;
  }
  if (data instanceof ArrayBuffer) {
    return data.byteLength;
  }
  if (Array.isArray(data)) {
    return data.reduce((acc, b) => acc + (Buffer.isBuffer(b) ? b.byteLength : 0), 0);
  }
  return 0;
}

/**
 * Mock Local WebSocket Feed Server
 * Operates purely on 127.0.0.1 on a dynamic loopback port.
 * Broadcasts deterministic market data ticks and supports replay recovery requests.
 */
export class MockLocalWebSocketFeedServer {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private host: string = '127.0.0.1';
  private port: number = 0;
  private maxPayload: number;
  private messageHistory: Map<string, RawMarketDataMessage> = new Map(); // key = `${venue_id}:${raw_symbol}:${seq}`
  private onConnectionHook: ((socket: WebSocket) => void) | null = null;

  constructor(options?: { maxPayload?: number }) {
    this.maxPayload = options?.maxPayload ?? MAX_WS_FRAME_BYTES;
  }

  public setOnConnectionHook(hook: ((socket: WebSocket) => void) | null): void {
    this.onConnectionHook = hook;
  }

  public async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({
          host: this.host,
          port: 0,
          maxPayload: this.maxPayload
        }, () => {
          const addr = this.wss?.address() as AddressInfo;
          this.port = addr.port;
          resolve(this.getUrl());
        });

        this.wss.on('connection', (socket: WebSocket) => {
          this.clients.add(socket);

          if (this.onConnectionHook) {
            try {
              this.onConnectionHook(socket);
            } catch {
              // hook error ignored fail-safe
            }
          }

          socket.on('message', (rawBytes: Buffer | ArrayBuffer | Buffer[]) => {
            this.handleClientMessage(socket, rawBytes);
          });

          socket.on('close', () => {
            this.clients.delete(socket);
          });

          socket.on('error', () => {
            this.clients.delete(socket);
          });
        });

        this.wss.on('error', (err) => {
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  public getUrl(): string {
    return `ws://${this.host}:${this.port}`;
  }

  public getPort(): number {
    return this.port;
  }

  public getConnectedClientCount(): number {
    return this.clients.size;
  }

  /**
   * Publishes a tick over the WebSocket to all connected clients.
   * If retainInHistory is true (default), stores in server log for replay service.
   * If false, tick is emitted without retaining, simulating an unrecoverable server-side gap.
   */
  public publishTick(msg: RawMarketDataMessage, retainInHistory: boolean = true): void {
    if (retainInHistory) {
      const histKey = `${msg.venue_id}:${msg.raw_symbol}:${BigInt(msg.sequence).toString()}`;
      this.messageHistory.set(histKey, { ...msg });
    }

    const frame: TickFrame = {
      type: 'TICK',
      message: msg
    };

    const payload = JSON.stringify(frame);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  /**
   * Sends raw string or buffer directly to clients (e.g. for testing malformed JSON or oversized frames)
   */
  public sendRawFrame(payload: string | Buffer): void {
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  /**
   * Forcibly drops all active WebSocket connections to test client reconnect & backoff
   */
  public simulateDropConnection(): void {
    for (const client of this.clients) {
      client.terminate();
    }
    this.clients.clear();
  }

  private handleClientMessage(socket: WebSocket, rawBytes: Buffer | ArrayBuffer | Buffer[] | string): void {
    if (getPayloadByteLength(rawBytes) > this.maxPayload) {
      return; // Oversized frame drop fail-closed
    }

    try {
      const dataStr = typeof rawBytes === 'string'
        ? rawBytes
        : Buffer.isBuffer(rawBytes)
          ? rawBytes.toString('utf8')
          : Buffer.from(rawBytes as any).toString('utf8');

      const parsed = JSON.parse(dataStr) as WebSocketWireFrame;
      if (parsed.type === 'REPLAY_REQUEST') {
        const fromSeq = BigInt(parsed.from_sequence);
        const toSeq = BigInt(parsed.to_sequence);
        const messages: RawMarketDataMessage[] = [];
        let missingAny = false;

        for (let seq = fromSeq; seq <= toSeq; seq++) {
          const key = `${parsed.venue_id}:${parsed.raw_symbol}:${seq.toString()}`;
          const found = this.messageHistory.get(key);
          if (found) {
            messages.push(found);
          } else {
            missingAny = true;
          }
        }

        if (missingAny || messages.length === 0) {
          const errorFrame: ReplayErrorFrame = {
            type: 'REPLAY_ERROR',
            venue_id: parsed.venue_id,
            raw_symbol: parsed.raw_symbol,
            from_sequence: parsed.from_sequence,
            to_sequence: parsed.to_sequence,
            reason: `Requested sequence range ${parsed.from_sequence}..${parsed.to_sequence} not fully available in server journal`
          };
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(errorFrame));
          }
        } else {
          const respFrame: ReplayResponseFrame = {
            type: 'REPLAY_RESPONSE',
            venue_id: parsed.venue_id,
            raw_symbol: parsed.raw_symbol,
            messages
          };
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(respFrame));
          }
        }
      }
    } catch {
      // Malformed client frames ignored fail-closed
    }
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const client of this.clients) {
        client.terminate();
      }
      this.clients.clear();

      if (this.wss) {
        this.wss.close(() => {
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

export interface WebSocketStreamingAdapterOptions {
  wsUrl: string;
  venue_id: string;
  maxReconnectAttempts?: number;
  reconnectBaseBackoffMs?: number;
  maxPayloadBytes?: number;
  stabilizationWindowMs?: number;
}

/**
 * WebSocket Streaming Market Feed Adapter
 * Connects asynchronously to a local WebSocket feed server.
 * 
 * Strict Provenance & Protocol Guards:
 * - Operates in SIMULATED_TEST transport mode.
 * - Always forces is_authenticated_source_feed: false fail-closed.
 * - Employs bounded exponential backoff on connection drops.
 * - Enforces connection instance isolation: frames from superseded socket instances are dropped.
 * - Enforces transport-level and application-level byte-accurate payload limits (MAX_WS_FRAME_BYTES).
 * - Drops oversized and malformed JSON frames fail-closed without crashing.
 * - Detects sequence gaps, requests server replay, and raises explicit UNRECOVERABLE_SEQUENCE_GAP
 *   when server replay fails.
 * - Avoids orphaned sockets or runaway retry loops when max reconnects are exhausted.
 */
export class WebSocketStreamingFeedAdapter {
  private wsUrl: string;
  private venue_id: string;
  private feedHandler: MarketFeedHandler;
  private state: WebSocketTransportState = 'DISCONNECTED';
  private ws: WebSocket | null = null;
  private currentConnectionInstanceId: number = 0;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number;
  private reconnectBaseBackoffMs: number;
  private maxPayloadBytes: number;
  private autoReconnect: boolean = true;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stabilizationWindowMs: number;
  private stabilizationTimer: NodeJS.Timeout | null = null;
  private pendingReplayRequest: ReplayRequestFrame | null = null;

  private messageListeners: Array<(res: FeedIngestionResult) => void> = [];
  private stateListeners: Array<(state: WebSocketTransportState) => void> = [];
  private unrecoverableGapListeners: Array<(gap: UnrecoverableGapReport) => void> = [];

  constructor(feedHandler: MarketFeedHandler, options: WebSocketStreamingAdapterOptions) {
    this.feedHandler = feedHandler;
    this.wsUrl = options.wsUrl;
    this.venue_id = options.venue_id;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    this.reconnectBaseBackoffMs = options.reconnectBaseBackoffMs ?? 25;
    this.maxPayloadBytes = options.maxPayloadBytes ?? MAX_WS_FRAME_BYTES;
    this.stabilizationWindowMs = options.stabilizationWindowMs ?? 25;
  }

  public isSimulated(): boolean {
    return true;
  }

  public getTransportType(): string {
    return 'LOCAL_WEBSOCKET_TCP';
  }

  public getConnectionState(): WebSocketTransportState {
    return this.state;
  }

  public getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  public getMaxPayloadBytes(): number {
    return this.maxPayloadBytes;
  }

  public onMessage(cb: (res: FeedIngestionResult) => void): () => void {
    this.messageListeners.push(cb);
    return () => {
      this.messageListeners = this.messageListeners.filter(l => l !== cb);
    };
  }

  public onStateChange(cb: (state: WebSocketTransportState) => void): () => void {
    this.stateListeners.push(cb);
    return () => {
      this.stateListeners = this.stateListeners.filter(l => l !== cb);
    };
  }

  public onUnrecoverableGap(cb: (gap: UnrecoverableGapReport) => void): () => void {
    this.unrecoverableGapListeners.push(cb);
    return () => {
      this.unrecoverableGapListeners = this.unrecoverableGapListeners.filter(l => l !== cb);
    };
  }

  private setState(newState: WebSocketTransportState): void {
    if (this.state === newState) return;
    this.state = newState;
    for (const listener of this.stateListeners) {
      try {
        listener(newState);
      } catch {
        // Safe listener execution
      }
    }
  }

  public async connect(): Promise<void> {
    if (this.state === 'CONNECTED') return;

    this.autoReconnect = true;
    this.setState('CONNECTING');

    const instanceId = ++this.currentConnectionInstanceId;

    return new Promise((resolve, reject) => {
      let resolved = false;

      try {
        const socket = new WebSocket(this.wsUrl, {
          maxPayload: this.maxPayloadBytes
        });
        this.ws = socket;

        socket.on('open', () => {
          if (this.currentConnectionInstanceId !== instanceId) {
            // Superseded socket instance
            socket.terminate();
            return;
          }

          this.setState('CONNECTED');
          if (!resolved) {
            resolved = true;
            resolve();
          }

          // Reset reconnectAttempts only after connection stabilizes
          if (this.stabilizationTimer) {
            clearTimeout(this.stabilizationTimer);
          }
          this.stabilizationTimer = setTimeout(() => {
            if (this.ws === socket && this.state === 'CONNECTED') {
              this.reconnectAttempts = 0;
            }
          }, this.stabilizationWindowMs);
        });

        socket.on('message', (rawBytes: Buffer | ArrayBuffer | Buffer[]) => {
          // Late message guard: ignore message if socket instance is superseded
          if (this.currentConnectionInstanceId !== instanceId || this.ws !== socket) {
            return;
          }
          this.handleWireMessage(rawBytes);
        });

        socket.on('close', () => {
          if (this.currentConnectionInstanceId !== instanceId) {
            return;
          }
          this.handleSocketClose(socket);
        });

        socket.on('error', (err) => {
          if (this.currentConnectionInstanceId !== instanceId) {
            return;
          }
          if (!resolved) {
            resolved = true;
            reject(err);
          }
        });
      } catch (err) {
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      }
    });
  }

  private handleSocketClose(socket: WebSocket): void {
    if (this.ws === socket) {
      this.ws = null;
    }

    if (this.stabilizationTimer) {
      clearTimeout(this.stabilizationTimer);
      this.stabilizationTimer = null;
    }

    // Reset pending replay on disconnect so replacement connection can re-request cleanly
    this.pendingReplayRequest = null;

    if (this.state === 'CLOSED' || !this.autoReconnect) {
      this.setState('DISCONNECTED');
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      // Reconnect exhausted: enter terminal CLOSED state and clear retries
      this.autoReconnect = false;
      this.setState('CLOSED');
      return;
    }

    this.setState('RECONNECTING');
    this.reconnectAttempts++;

    // Bounded exponential backoff
    const delayMs = Math.min(
      this.reconnectBaseBackoffMs * Math.pow(2, this.reconnectAttempts - 1),
      500
    );

    this.reconnectTimer = setTimeout(() => {
      if (this.state === 'RECONNECTING' && this.autoReconnect) {
        this.connect().catch(() => {
          // Reconnect loop continues on close
        });
      }
    }, delayMs);
  }

  public handleWireMessage(rawBytes: Buffer | ArrayBuffer | Buffer[] | string): boolean {
    // 1. Byte-accurate oversized frame guard (evaluates UTF-8 bytes, not UTF-16 code units)
    const byteLength = getPayloadByteLength(rawBytes);
    if (byteLength > this.maxPayloadBytes) {
      return false; // Dropped fail-closed
    }

    const dataStr = typeof rawBytes === 'string'
      ? rawBytes
      : Buffer.isBuffer(rawBytes)
        ? rawBytes.toString('utf8')
        : Buffer.from(rawBytes as any).toString('utf8');

    try {
      const parsed = JSON.parse(dataStr);

      if (parsed.type === 'TICK' && parsed.message) {
        const raw: RawMarketDataMessage = parsed.message;
        const nowUtc = new Date().toISOString();

        // Strict Provenance Guard: force is_authenticated_source_feed: false unconditionally
        const sanitizedMsg: RawMarketDataMessage = {
          ...raw,
          is_authenticated_source_feed: false
        };

        const result = this.feedHandler.ingestRawMessage(sanitizedMsg, nowUtc);

        // Gap detection -> request replay over WebSocket
        if (result.outcome === 'GAP_DETECTED') {
          const replayReq: ReplayRequestFrame = {
            type: 'REPLAY_REQUEST',
            venue_id: raw.venue_id,
            raw_symbol: raw.raw_symbol,
            from_sequence: result.expected_sequence,
            to_sequence: result.received_sequence
          };
          this.pendingReplayRequest = replayReq;
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(replayReq));
          }
        }

        // Notify listeners
        for (const listener of this.messageListeners) {
          try {
            listener(result);
          } catch {
            // Safe listener execution
          }
        }
      } else if (parsed.type === 'REPLAY_RESPONSE' && Array.isArray(parsed.messages)) {
        this.pendingReplayRequest = null;
        const nowUtc = new Date().toISOString();

        // Force unauthenticated provenance on replay messages as well
        const sanitizedReplay = parsed.messages.map((m: RawMarketDataMessage) => ({
          ...m,
          is_authenticated_source_feed: false
        }));

        const replayResults = this.feedHandler.replayAndSync(sanitizedReplay, nowUtc);
        for (const res of replayResults) {
          for (const listener of this.messageListeners) {
            try {
              listener(res);
            } catch {
              // Safe listener execution
            }
          }
        }
      } else if (parsed.type === 'REPLAY_ERROR') {
        this.pendingReplayRequest = null;
        // Gap recovery failed -> unrecoverable sequence gap
        const errorFrame = parsed as ReplayErrorFrame;
        const fromSeq = BigInt(errorFrame.from_sequence);
        const toSeq = BigInt(errorFrame.to_sequence);
        const gapReport: UnrecoverableGapReport = {
          venue_id: errorFrame.venue_id,
          raw_symbol: errorFrame.raw_symbol,
          expected_sequence: errorFrame.from_sequence,
          received_sequence: errorFrame.to_sequence,
          gap_size: Number(toSeq - fromSeq),
          reason: `UNRECOVERABLE_SEQUENCE_GAP: ${errorFrame.reason}`,
          reported_at_utc: new Date().toISOString()
        };

        for (const listener of this.unrecoverableGapListeners) {
          try {
            listener(gapReport);
          } catch {
            // Safe listener execution
          }
        }
      }
      return true;
    } catch {
      // Discard malformed socket frames fail-closed
      return false;
    }
  }

  public async disconnect(): Promise<void> {
    this.autoReconnect = false;
    this.currentConnectionInstanceId++; // invalidate pending socket events

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.stabilizationTimer) {
      clearTimeout(this.stabilizationTimer);
      this.stabilizationTimer = null;
    }

    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      return new Promise((resolve) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.on('close', () => {
            this.setState('DISCONNECTED');
            resolve();
          });
          socket.terminate();
        } else {
          socket.terminate();
          this.setState('DISCONNECTED');
          resolve();
        }
      });
    } else {
      this.setState('DISCONNECTED');
    }
  }
}
