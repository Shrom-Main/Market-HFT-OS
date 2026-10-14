import {
  CanonicalMoney,
  validateIso8601UtcTimestamp
} from '../canonical/domain.js';
import {
  DeterministicClock,
  DeterministicIdGenerator
} from '../canonical/deterministic.js';
import { deepFreeze } from '../verification/gate.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import { sha256 } from '../canonical/crypto.js';
import { ExecutionIntent } from './engine.js';

export type SimulatedOrderStatus =
  | 'ACKNOWLEDGED'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELLATION_REQUESTED'
  | 'CANCELLED'
  | 'REJECTED';

export interface SimulatedFillEvent {
  fill_id: string;
  order_id: string;
  fill_timestamp_utc: string;
  fill_price: CanonicalMoney;
  fill_quantity: number;
  cumulative_quantity: number;
  remaining_quantity: number;
}

export interface SimulatedOrderTransitionEvent {
  event_id: string;
  order_id: string;
  intent_id: string;
  sequence_number: number;
  timestamp_utc: string;
  previous_status: SimulatedOrderStatus | null;
  resulting_status: SimulatedOrderStatus;
  transition_reason: string;
  fill_id?: string;
  delta_filled_quantity?: number;
  remaining_quantity: number;
}

export interface SimulatedOrderRecord {
  order_id: string;
  intent_id: string;
  offer_id: string;
  product_id: string;
  venue_id: string;
  side: 'BUY' | 'SELL';
  order_price: CanonicalMoney;
  total_quantity: number;
  filled_quantity: number;
  remaining_quantity: number;
  status: SimulatedOrderStatus;
  created_at_utc: string;
  updated_at_utc: string;
  fills: readonly SimulatedFillEvent[];
  events: readonly SimulatedOrderTransitionEvent[];
  rejection_reason?: string;
  intent_sha256: string;
}

export interface SimulatedExecutionGatewayOptions {
  clock?: DeterministicClock;
  idGenerator?: DeterministicIdGenerator;
}

/**
 * Simulated Execution Gateway & Order State Machine
 * Consumes DRY_RUN Execution Intents and manages order lifecycle transitions
 * without live capital deployment or actuals ledger mutation.
 */
export class SimulatedExecutionGateway {
  private ordersByIntentId: Map<string, SimulatedOrderRecord> = new Map();
  private ordersById: Map<string, SimulatedOrderRecord> = new Map();
  private clock?: DeterministicClock;
  private idGenerator?: DeterministicIdGenerator;

  constructor(options?: SimulatedExecutionGatewayOptions) {
    this.clock = options?.clock;
    this.idGenerator = options?.idGenerator;
  }

  public getClock(): DeterministicClock | undefined {
    return this.clock;
  }

  public getIdGenerator(): DeterministicIdGenerator | undefined {
    return this.idGenerator;
  }

  private cloneAndFreezeOrder(order: SimulatedOrderRecord): SimulatedOrderRecord {
    return deepFreeze({
      ...order,
      fills: order.fills.map(f => ({ ...f })),
      events: order.events.map(e => ({ ...e }))
    });
  }

  /**
   * Submits an execution intent to the simulated gateway.
   * Idempotent: repeated submission of the identical canonical intent hash returns the existing order.
   * Conflicting submission under the same intent_id throws E-ERR-039: IDEMPOTENCY_CONFLICT.
   */
  public submitExecutionIntent(intent: ExecutionIntent, current_time_utc?: string): SimulatedOrderRecord {
    const timeUtc = current_time_utc ?? this.clock?.nowUtc() ?? new Date().toISOString();
    validateIso8601UtcTimestamp(timeUtc);

    // 1. Dual-Ledger Safety Isolation: strictly DRY_RUN
    if (intent.payload.mode !== 'DRY_RUN') {
      throw new Error('E-ERR-020: ACTUALS_LEDGER_WRITE_VIOLATION: Live capital orders cannot route to simulated execution gateway');
    }

    // 1b. Verify Canonical Intent Hash
    const canonicalPayloadBytes = Buffer.from(canonicalizeJCS(intent.payload), 'utf8');
    const expectedHash = sha256(canonicalPayloadBytes);
    if (intent.canonical_intent_sha256 !== expectedHash) {
      throw new Error('E-ERR-024: INVALID_INTENT_DIGEST: Intent canonical hash does not match payload JCS hash');
    }

    // 2. Idempotency Check
    const existing = this.ordersByIntentId.get(intent.payload.intent_id);
    if (existing) {
      if (existing.intent_sha256 !== intent.canonical_intent_sha256) {
        throw new Error(
          `E-ERR-039: IDEMPOTENCY_CONFLICT: Intent ID '${intent.payload.intent_id}' already submitted with different canonical hash`
        );
      }
      return this.cloneAndFreezeOrder(existing);
    }

    const order_id = `sim:ord:${intent.payload.intent_id}`;

    // 3. Execution Decision Check
    if (intent.payload.decision_status !== 'EXECUTE_DRY_RUN') {
      const reason = `Intent rejected by engine: ${intent.payload.decision_status} - ${intent.payload.decision_reason}`;
      const initialEvent: SimulatedOrderTransitionEvent = {
        event_id: `evt:${order_id}:1`,
        order_id,
        intent_id: intent.payload.intent_id,
        sequence_number: 1,
        timestamp_utc: timeUtc,
        previous_status: null,
        resulting_status: 'REJECTED',
        transition_reason: reason,
        remaining_quantity: intent.payload.order_quantity
      };

      const rejectedOrder: SimulatedOrderRecord = {
        order_id,
        intent_id: intent.payload.intent_id,
        offer_id: intent.payload.offer_id,
        product_id: intent.payload.product_id,
        venue_id: intent.payload.venue_id,
        side: intent.payload.target_side,
        order_price: intent.payload.market_unit_price,
        total_quantity: intent.payload.order_quantity,
        filled_quantity: 0,
        remaining_quantity: intent.payload.order_quantity,
        status: 'REJECTED',
        created_at_utc: timeUtc,
        updated_at_utc: timeUtc,
        fills: [],
        events: [initialEvent],
        rejection_reason: reason,
        intent_sha256: intent.canonical_intent_sha256
      };
      this.ordersById.set(order_id, rejectedOrder);
      this.ordersByIntentId.set(intent.payload.intent_id, rejectedOrder);
      return this.cloneAndFreezeOrder(rejectedOrder);
    }

    // 4. Acknowledged Order Creation
    const initialEvent: SimulatedOrderTransitionEvent = {
      event_id: `evt:${order_id}:1`,
      order_id,
      intent_id: intent.payload.intent_id,
      sequence_number: 1,
      timestamp_utc: timeUtc,
      previous_status: null,
      resulting_status: 'ACKNOWLEDGED',
      transition_reason: 'Order acknowledged by venue',
      remaining_quantity: intent.payload.order_quantity
    };

    const order: SimulatedOrderRecord = {
      order_id,
      intent_id: intent.payload.intent_id,
      offer_id: intent.payload.offer_id,
      product_id: intent.payload.product_id,
      venue_id: intent.payload.venue_id,
      side: intent.payload.target_side,
      order_price: intent.payload.market_unit_price,
      total_quantity: intent.payload.order_quantity,
      filled_quantity: 0,
      remaining_quantity: intent.payload.order_quantity,
      status: 'ACKNOWLEDGED',
      created_at_utc: timeUtc,
      updated_at_utc: timeUtc,
      fills: [],
      events: [initialEvent],
      intent_sha256: intent.canonical_intent_sha256
    };

    this.ordersById.set(order_id, order);
    this.ordersByIntentId.set(intent.payload.intent_id, order);
    return this.cloneAndFreezeOrder(order);
  }

  /**
   * Simulates an order fill or partial fill from market liquidity.
   * Handles fills arriving while cancellation is pending (cancellation/fill race),
   * strictly preserving filled_quantity + remaining_quantity === total_quantity.
   */
  public simulateFill(
    order_id: string,
    fill_quantity: number,
    fill_price: CanonicalMoney,
    current_time_utc?: string,
    custom_fill_id?: string
  ): SimulatedOrderRecord {
    const timeUtc = current_time_utc ?? this.clock?.nowUtc() ?? new Date().toISOString();
    validateIso8601UtcTimestamp(timeUtc);

    const order = this.ordersById.get(order_id);
    if (!order) {
      throw new Error(`E-ERR-024: ORDER_NOT_FOUND: Simulated order '${order_id}' does not exist`);
    }

    if (['FILLED', 'CANCELLED', 'REJECTED'].includes(order.status)) {
      throw new Error(`E-ERR-036: TERMINAL_ORDER_STATE: Cannot fill order in terminal status '${order.status}'`);
    }

    if (!Number.isSafeInteger(fill_quantity) || fill_quantity <= 0) {
      throw new Error(`E-ERR-024: INVALID_FILL_QUANTITY: Fill quantity must be a positive safe integer, got ${fill_quantity}`);
    }

    if (fill_quantity > order.remaining_quantity) {
      throw new Error(`E-ERR-024: FILL_EXCEEDS_REMAINING: Fill quantity ${fill_quantity} exceeds remaining quantity ${order.remaining_quantity}`);
    }

    const newFilled = order.filled_quantity + fill_quantity;
    const newRemaining = order.total_quantity - newFilled;

    // Invariant check: filled + remaining must strictly equal total
    if (newFilled + newRemaining !== order.total_quantity) {
      throw new Error(`E-ERR-024: INVARIANT_VIOLATION: filled (${newFilled}) + remaining (${newRemaining}) != total (${order.total_quantity})`);
    }

    // Determine resulting status:
    // If all remaining quantity is filled, order is FILLED regardless of pending cancellation.
    // If partial fill arrives while CANCELLATION_REQUESTED, order remains CANCELLATION_REQUESTED.
    // Otherwise PARTIALLY_FILLED.
    let newStatus: SimulatedOrderStatus;
    let reason: string;
    if (newRemaining === 0) {
      newStatus = 'FILLED';
      reason = order.status === 'CANCELLATION_REQUESTED'
        ? 'Full fill executed racing against pending cancellation'
        : 'Order fully filled';
    } else if (order.status === 'CANCELLATION_REQUESTED') {
      newStatus = 'CANCELLATION_REQUESTED';
      reason = 'Partial fill executed while cancellation pending';
    } else {
      newStatus = 'PARTIALLY_FILLED';
      reason = 'Partial fill executed';
    }

    const fillId = custom_fill_id ?? (this.idGenerator ? this.idGenerator.nextId(`fill:${order_id}`) : `fill:${order_id}:${order.fills.length + 1}`);
    const fillEvent: SimulatedFillEvent = {
      fill_id: fillId,
      order_id,
      fill_timestamp_utc: timeUtc,
      fill_price,
      fill_quantity,
      cumulative_quantity: newFilled,
      remaining_quantity: newRemaining
    };

    const nextSeq = order.events.length + 1;
    const transitionEvent: SimulatedOrderTransitionEvent = {
      event_id: `evt:${order_id}:${nextSeq}`,
      order_id,
      intent_id: order.intent_id,
      sequence_number: nextSeq,
      timestamp_utc: timeUtc,
      previous_status: order.status,
      resulting_status: newStatus,
      transition_reason: reason,
      fill_id: fillEvent.fill_id,
      delta_filled_quantity: fill_quantity,
      remaining_quantity: newRemaining
    };

    const updatedOrder: SimulatedOrderRecord = {
      ...order,
      filled_quantity: newFilled,
      remaining_quantity: newRemaining,
      status: newStatus,
      updated_at_utc: timeUtc,
      fills: [...order.fills, fillEvent],
      events: [...order.events, transitionEvent]
    };

    this.ordersById.set(order_id, updatedOrder);
    this.ordersByIntentId.set(order.intent_id, updatedOrder);
    return this.cloneAndFreezeOrder(updatedOrder);
  }

  /**
   * Requests cancellation of an outstanding open order.
   * Transitions order to CANCELLATION_REQUESTED. Does not report CANCELLED until confirmCancellation is called.
   */
  public requestCancellation(order_id: string, current_time_utc?: string, reason?: string): SimulatedOrderRecord {
    const timeUtc = current_time_utc ?? this.clock?.nowUtc() ?? new Date().toISOString();
    validateIso8601UtcTimestamp(timeUtc);

    const order = this.ordersById.get(order_id);
    if (!order) {
      throw new Error(`E-ERR-024: ORDER_NOT_FOUND: Simulated order '${order_id}' does not exist`);
    }

    if (['FILLED', 'CANCELLED', 'REJECTED'].includes(order.status)) {
      throw new Error(`E-ERR-036: TERMINAL_ORDER_STATE: Cannot cancel order in terminal status '${order.status}'`);
    }

    if (order.status === 'CANCELLATION_REQUESTED') {
      return this.cloneAndFreezeOrder(order);
    }

    const nextSeq = order.events.length + 1;
    const transitionEvent: SimulatedOrderTransitionEvent = {
      event_id: `evt:${order_id}:${nextSeq}`,
      order_id,
      intent_id: order.intent_id,
      sequence_number: nextSeq,
      timestamp_utc: timeUtc,
      previous_status: order.status,
      resulting_status: 'CANCELLATION_REQUESTED',
      transition_reason: reason ?? 'Cancellation requested by client',
      remaining_quantity: order.remaining_quantity
    };

    const updatedOrder: SimulatedOrderRecord = {
      ...order,
      status: 'CANCELLATION_REQUESTED',
      updated_at_utc: timeUtc,
      events: [...order.events, transitionEvent]
    };

    this.ordersById.set(order_id, updatedOrder);
    this.ordersByIntentId.set(order.intent_id, updatedOrder);
    return this.cloneAndFreezeOrder(updatedOrder);
  }

  /**
   * Confirms cancellation outcome from venue matching engine.
   * Transitions order from CANCELLATION_REQUESTED to CANCELLED.
   */
  public confirmCancellation(order_id: string, current_time_utc?: string, reason?: string): SimulatedOrderRecord {
    const timeUtc = current_time_utc ?? this.clock?.nowUtc() ?? new Date().toISOString();
    validateIso8601UtcTimestamp(timeUtc);

    const order = this.ordersById.get(order_id);
    if (!order) {
      throw new Error(`E-ERR-024: ORDER_NOT_FOUND: Simulated order '${order_id}' does not exist`);
    }

    if (order.status === 'CANCELLED') {
      return this.cloneAndFreezeOrder(order);
    }

    if (['FILLED', 'REJECTED'].includes(order.status)) {
      throw new Error(`E-ERR-036: TERMINAL_ORDER_STATE: Cannot confirm cancellation on order in terminal status '${order.status}'`);
    }

    if (order.status !== 'CANCELLATION_REQUESTED') {
      throw new Error(`E-ERR-037: CANCELLATION_NOT_REQUESTED: Order '${order_id}' must be in CANCELLATION_REQUESTED status prior to confirmation; current status is '${order.status}'`);
    }

    const nextSeq = order.events.length + 1;
    const transitionEvent: SimulatedOrderTransitionEvent = {
      event_id: `evt:${order_id}:${nextSeq}`,
      order_id,
      intent_id: order.intent_id,
      sequence_number: nextSeq,
      timestamp_utc: timeUtc,
      previous_status: 'CANCELLATION_REQUESTED',
      resulting_status: 'CANCELLED',
      transition_reason: reason ?? 'Cancellation confirmed by venue',
      remaining_quantity: order.remaining_quantity
    };

    const cancelledOrder: SimulatedOrderRecord = {
      ...order,
      status: 'CANCELLED',
      updated_at_utc: timeUtc,
      events: [...order.events, transitionEvent]
    };

    this.ordersById.set(order_id, cancelledOrder);
    this.ordersByIntentId.set(order.intent_id, cancelledOrder);
    return this.cloneAndFreezeOrder(cancelledOrder);
  }

  public getOrder(order_id: string): SimulatedOrderRecord | null {
    const order = this.ordersById.get(order_id);
    return order ? this.cloneAndFreezeOrder(order) : null;
  }

  public getOrderByIntentId(intent_id: string): SimulatedOrderRecord | null {
    const order = this.ordersByIntentId.get(intent_id);
    return order ? this.cloneAndFreezeOrder(order) : null;
  }

  public getAllOrders(): readonly SimulatedOrderRecord[] {
    return deepFreeze(Array.from(this.ordersById.values()).map(o => this.cloneAndFreezeOrder(o)));
  }
}
