import {
  RawMarketDataMessage,
  MarketFeedHandler,
  FeedIngestionResult
} from './feedHandler.js';

export type AdapterConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING';

export interface StreamingAdapterOptions {
  venue_id: string;
  isAuthenticatedSource?: boolean;
  adapterId?: string;
}

export interface ReplayRequestSummary {
  venue_id: string;
  raw_symbol: string;
  from_sequence: string;
  to_sequence: string;
  requested_at_utc: string;
  messages_found: number;
  gap_resolved: boolean;
}

/**
 * Deterministic Simulated Streaming Market Feed Adapter
 * Emulates streaming WebSocket / event-stream connection lifecycle
 * without requiring external network connectivity or exchange API credentials.
 */
export class SimulatedStreamingMarketFeedAdapter {
  private state: AdapterConnectionState = 'DISCONNECTED';
  private venue_id: string;
  private isAuthenticatedSource: boolean;
  private adapterId: string;
  private feedHandler: MarketFeedHandler;
  private messageHistory: Map<string, RawMarketDataMessage> = new Map(); // key = `${venue_id}:${raw_symbol}:${sequence}`
  private eventListeners: Array<(res: FeedIngestionResult) => void> = [];

  constructor(feedHandler: MarketFeedHandler, options: StreamingAdapterOptions) {
    this.feedHandler = feedHandler;
    this.venue_id = options.venue_id;
    this.isAuthenticatedSource = options.isAuthenticatedSource ?? false;
    this.adapterId = options.adapterId ?? `adapter:sim:${options.venue_id}`;
  }

  public getConnectionState(): AdapterConnectionState {
    return this.state;
  }

  public getAdapterId(): string {
    return this.adapterId;
  }

  public isAuthenticated(): boolean {
    return this.isAuthenticatedSource;
  }

  public connect(): void {
    if (this.state === 'CONNECTED') return;
    this.state = 'CONNECTED';
  }

  public disconnect(): void {
    this.state = 'DISCONNECTED';
  }

  public reconnect(): void {
    this.state = 'RECONNECTING';
    // Deterministic simulation transitions directly to CONNECTED
    this.state = 'CONNECTED';
  }

  public onMessage(listener: (res: FeedIngestionResult) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter(l => l !== listener);
    };
  }

  /**
   * Receives and streams a raw market data tick into the engine
   */
  public pushMessage(msg: RawMarketDataMessage, ingested_at_utc: string): FeedIngestionResult {
    if (this.state !== 'CONNECTED') {
      throw new Error(`E-ERR-038: ADAPTER_NOT_CONNECTED: Cannot push message while adapter is in state '${this.state}'`);
    }

    if (msg.venue_id !== this.venue_id) {
      throw new Error(`E-ERR-024: VENUE_MISMATCH: Adapter venue '${this.venue_id}' does not match message venue '${msg.venue_id}'`);
    }

    // Bind adapter's declared authentication status
    const boundMsg: RawMarketDataMessage = {
      ...msg,
      is_authenticated_source_feed: this.isAuthenticatedSource
    };

    // Store in history for deterministic replay support
    const histKey = `${msg.venue_id}:${msg.raw_symbol}:${BigInt(msg.sequence).toString()}`;
    this.messageHistory.set(histKey, boundMsg);

    // Ingest into feed handler
    const result = this.feedHandler.ingestRawMessage(boundMsg, ingested_at_utc);

    // Notify listeners
    for (const listener of this.eventListeners) {
      try {
        listener(result);
      } catch {
        // Listener safety
      }
    }

    return result;
  }

  /**
   * Replays missing message sequence range from historical journal to recover from detected gap
   */
  public recoverGapViaReplay(
    raw_symbol: string,
    fromSeq: number | string,
    toSeq: number | string,
    ingested_at_utc: string
  ): ReplayRequestSummary {
    if (this.state !== 'CONNECTED') {
      throw new Error(`E-ERR-038: ADAPTER_NOT_CONNECTED: Cannot request replay while adapter is in state '${this.state}'`);
    }

    const fromBig = BigInt(fromSeq);
    const toBig = BigInt(toSeq);
    const messagesToReplay: RawMarketDataMessage[] = [];

    for (let seq = fromBig; seq <= toBig; seq++) {
      const key = `${this.venue_id}:${raw_symbol}:${seq.toString()}`;
      const found = this.messageHistory.get(key);
      if (found) {
        messagesToReplay.push(found);
      }
    }

    // Replay in order
    this.feedHandler.replayAndSync(messagesToReplay, ingested_at_utc);

    const canonicalProdId = this.feedHandler.getCanonicalProductId(this.venue_id, raw_symbol);
    const pendingCount = this.feedHandler.getPendingGapCount(this.venue_id, canonicalProdId);

    return {
      venue_id: this.venue_id,
      raw_symbol,
      from_sequence: fromBig.toString(),
      to_sequence: toBig.toString(),
      requested_at_utc: ingested_at_utc,
      messages_found: messagesToReplay.length,
      gap_resolved: pendingCount === 0
    };
  }
}
