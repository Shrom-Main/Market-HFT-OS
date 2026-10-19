import { ProductObservationDeckResponse, ProductObservationItem } from '../types/product';
import {
  TerminalSnapshot,
  SignalEnvelope,
  SignalTraceRecord,
  WhatIfSimulationResult,
  AiOpportunityAnalysisResult,
  KillSwitchTier
} from '../types/workstation';

const BASE_URL = '';

export class WorkstationApiClient {
  // 1. Fetch Complete Product Observation Deck
  public static async getProducts(): Promise<ProductObservationDeckResponse> {
    const res = await fetch(`${BASE_URL}/api/products/universe`);
    if (!res.ok) {
      throw new Error(`Failed to load product universe: ${res.statusText}`);
    }
    return res.json();
  }

  // 2. Fetch Single Product Detail
  public static async getProductDetail(productId: string): Promise<ProductObservationItem> {
    const res = await fetch(`${BASE_URL}/api/products/detail?id=${encodeURIComponent(productId)}`);
    if (!res.ok) {
      throw new Error(`Failed to load product detail: ${res.statusText}`);
    }
    return res.json();
  }

  // 3. Push New Product Observation to Deck
  public static async pushProductObservation(payload: any): Promise<{ success: boolean; product: ProductObservationItem }> {
    const res = await fetch(`${BASE_URL}/api/products/observe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.operator_message || `Failed to push product: ${res.statusText}`);
    }
    return res.json();
  }

  // 4. Dispatch Research Workflow to Specialist Agents
  public static async dispatchResearch(productId: string, operatorNotes?: string): Promise<{ success: boolean; status: string; run_id: string }> {
    const res = await fetch(`${BASE_URL}/api/products/research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: productId,
        operator_notes: operatorNotes || 'Dispatched from Cockpit UI',
        investigation_depth: 'EXHAUSTIVE',
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.operator_message || `Failed to dispatch research: ${res.statusText}`);
    }
    return res.json();
  }

  // 5. Fetch Full Snapshot
  public static async getSnapshot(): Promise<TerminalSnapshot> {
    const res = await fetch(`${BASE_URL}/api/snapshot`);
    if (!res.ok) {
      throw new Error(`Failed to fetch snapshot: ${res.statusText}`);
    }
    return res.json();
  }

  // 6. Fetch Health
  public static async getHealth(): Promise<{ status: string; port: number; uptime_seconds: number }> {
    const res = await fetch(`${BASE_URL}/api/health`);
    if (!res.ok) {
      throw new Error(`Failed to fetch health: ${res.statusText}`);
    }
    return res.json();
  }

  // 7. Fetch Signal Surveillance Inbox
  public static async getSignalsInbox(): Promise<SignalEnvelope[]> {
    const res = await fetch(`${BASE_URL}/api/signals/inbox`);
    if (!res.ok) {
      return [];
    }
    const data = await res.json();
    return data.signals || [];
  }

  // 8. Fetch Signal Trace Records
  public static async getSignalTrace(signalId?: string): Promise<SignalTraceRecord[]> {
    const url = signalId ? `${BASE_URL}/api/signals/trace?id=${encodeURIComponent(signalId)}` : `${BASE_URL}/api/signals/trace`;
    const res = await fetch(url);
    if (!res.ok) {
      return [];
    }
    const data = await res.json();
    return data.trace_records || [];
  }

  // 9. Ingest Signal Envelope
  public static async ingestSignal(envelope: any): Promise<{ success: boolean; signal_id: string }> {
    const res = await fetch(`${BASE_URL}/api/signals/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.operator_message || `Signal ingestion failed: ${res.statusText}`);
    }
    return res.json();
  }

  // 10. Trigger Governed DAG Run across Certified Micro-Agents
  public static async runGovernedDag(operatorRationale: string): Promise<{ success: boolean; run_id: string }> {
    const res = await fetch(`${BASE_URL}/api/actions/run-dag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_confirmation_token: 'CONFIRM_RUN_DAG_WAVE',
        operator_rationale: operatorRationale,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.operator_message || `DAG run failed: ${res.statusText}`);
    }
    return res.json();
  }

  // 11. Set Kill Switch State
  public static async setKillSwitch(tier: KillSwitchTier, operatorRationale: string): Promise<{ success: boolean; tier: string }> {
    const res = await fetch(`${BASE_URL}/api/actions/kill-switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_tier: tier,
        operator_rationale: operatorRationale,
        confirmation_token: `CONFIRM_${tier}`,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.operator_message || `Kill switch transition failed: ${res.statusText}`);
    }
    return res.json();
  }

  // 12. Pure BigInt Rational What-If Simulation
  public static async evaluateWhatIf(formulaExpression: string, variables: Record<string, number>): Promise<WhatIfSimulationResult> {
    const res = await fetch(`${BASE_URL}/api/actions/what-if-formula`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        formula_expression: formulaExpression,
        variables,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.operator_message || `What-if calculation failed: ${res.statusText}`);
    }
    return res.json();
  }

  // 13. Groq AI Opportunity Analysis
  public static async analyzeOpportunityWithGroq(productId: string, promptNotes?: string): Promise<AiOpportunityAnalysisResult> {
    const res = await fetch(`${BASE_URL}/api/ai/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: productId,
        prompt_notes: promptNotes || 'Perform comprehensive grievance mining and operational edge analysis',
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.operator_message || `AI analysis failed: ${res.statusText}`);
    }
    return res.json();
  }

  // 14. Live WebSocket Connection Manager
  public static connectWebSocket(
    onSnapshot: (snapshot: any) => void,
    onStatusChange?: (status: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED') => void
  ): () => void {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host || '127.0.0.1:4310'}/ws`;

    let socket: WebSocket | null = null;
    let reconnectTimeout: any = null;
    let isExplicitlyClosed = false;

    function connect() {
      if (isExplicitlyClosed) return;
      onStatusChange?.('CONNECTING');
      try {
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
          onStatusChange?.('CONNECTED');
        };

        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            onSnapshot(data);
          } catch {
            // ignore non-json frames
          }
        };

        socket.onclose = () => {
          onStatusChange?.('DISCONNECTED');
          if (!isExplicitlyClosed) {
            reconnectTimeout = setTimeout(connect, 2000);
          }
        };

        socket.onerror = () => {
          socket?.close();
        };
      } catch {
        onStatusChange?.('DISCONNECTED');
        reconnectTimeout = setTimeout(connect, 3000);
      }
    }

    connect();

    return () => {
      isExplicitlyClosed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      socket?.close();
    };
  }

  // 14. Gate M8.0: Fetch Evidence Gap Matrix
  public static async getEvidenceGaps(productId: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/api/research/gaps?product_id=${encodeURIComponent(productId)}`);
    if (!res.ok) {
      throw new Error(`Failed to load evidence gaps: ${res.statusText}`);
    }
    return res.json();
  }

  // 15. Gate M8.0: Fetch Bitemporal Series with Event Overlays
  public static async getBitemporalSeries(productId: string, asOfUtc?: string): Promise<any> {
    const url = asOfUtc
      ? `${BASE_URL}/api/bitemporal/series?product_id=${encodeURIComponent(productId)}&as_of=${encodeURIComponent(asOfUtc)}`
      : `${BASE_URL}/api/bitemporal/series?product_id=${encodeURIComponent(productId)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to load bitemporal series: ${res.statusText}`);
    }
    return res.json();
  }

  // 16. Gate M8.0: Evaluate Multi-Scenario Paper Bundle
  public static async evaluateBundle(intent: any): Promise<any> {
    const res = await fetch(`${BASE_URL}/api/bundle/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(intent)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.operator_message || `Bundle evaluation failed: ${res.statusText}`);
    }
    return res.json();
  }

  // 17. Gate M8.0: Commit Bundle Allocation under Governed Confirmation Gate
  public static async commitBundle(payload: { evaluation: any; confirmation: any }): Promise<any> {
    const res = await fetch(`${BASE_URL}/api/bundle/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.operator_message || `Bundle commit failed: ${res.statusText}`);
    }
    return res.json();
  }

  // 18. Gate M8.0: Check Live Database Connection Status
  public static async getDatabaseHealth(): Promise<any> {
    const res = await fetch(`${BASE_URL}/api/health/db`);
    if (!res.ok) {
      return { is_connected: false, backend: 'IN_MEMORY_FALLBACK' };
    }
    return res.json();
  }
}

