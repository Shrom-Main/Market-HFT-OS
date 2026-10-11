import {
  CanonicalMoney,
  validateIso8601UtcTimestamp
} from '../canonical/domain.js';
import { deepFreeze } from '../verification/gate.js';
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
  rejection_reason?: string;
  intent_sha256: string;
}

/**
 * Simulated Execution Gateway & Order State Machine
 * Consumes DRY_RUN Execution Intents and manages order lifecycle transitions
 * without live capital deployment or actuals ledger mutation.
 */
export class SimulatedExecutionGateway {
  private ordersByIntentId: Map<string, SimulatedOrderRecord> = new Map();
  private ordersById: Map<string, SimulatedOrderRecord> = new Map();

  /**
   * Submits an execution intent to the simulated gateway.
   * Idempotent: repeated submission of the same intent_id returns the existing order.
   */
  public submitExecutionIntent(intent: ExecutionIntent, current_time_utc: string): SimulatedOrderRecord {
    validateIso8601UtcTimestamp(current_time_utc);

    // 1. Dual-Ledger Safety Isolation: strictly DRY_RUN
    if (intent.payload.mode !== 'DRY_RUN') {
      throw new Error('E-ERR-020: ACTUALS_LEDGER_WRITE_VIOLATION: Live capital orders cannot route to simulated execution gateway');
    }

    // 2. Idempotency Check: if intent already registered, return existing state
    const existing = this.ordersByIntentId.get(intent.payload.intent_id);
    if (existing) {
      return existing;
    }

    const order_id = `sim:ord:${intent.payload.intent_id}`;

    // 3. Execution Decision Check
    if (intent.payload.decision_status !== 'EXECUTE_DRY_RUN') {
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
        created_at_utc: current_time_utc,
        updated_at_utc: current_time_utc,
        fills: [],
        rejection_reason: `Intent rejected by engine: ${intent.payload.decision_status} - ${intent.payload.decision_reason}`,
        intent_sha256: intent.canonical_intent_sha256
      };
      this.ordersById.set(order_id, rejectedOrder);
      this.ordersByIntentId.set(intent.payload.intent_id, rejectedOrder);
      return deepFreeze({ ...rejectedOrder });
    }

    // 4. Acknowledged Order Creation
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
      created_at_utc: current_time_utc,
      updated_at_utc: current_time_utc,
      fills: [],
      intent_sha256: intent.canonical_intent_sha256
    };

    this.ordersById.set(order_id, order);
    this.ordersByIntentId.set(intent.payload.intent_id, order);
    return deepFreeze({ ...order });
  }

  /**
   * Simulates an order fill or partial fill from market liquidity
   */
  public simulateFill(
    order_id: string,
    fill_quantity: number,
    fill_price: CanonicalMoney,
    current_time_utc: string
  ): SimulatedOrderRecord {
    validateIso8601UtcTimestamp(current_time_utc);

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
    const newStatus: SimulatedOrderStatus = newRemaining === 0 ? 'FILLED' : 'PARTIALLY_FILLED';

    const fillEvent: SimulatedFillEvent = {
      fill_id: `fill:${order_id}:${order.fills.length + 1}`,
      order_id,
      fill_timestamp_utc: current_time_utc,
      fill_price,
      fill_quantity,
      cumulative_quantity: newFilled,
      remaining_quantity: newRemaining
    };

    const updatedOrder: SimulatedOrderRecord = {
      ...order,
      filled_quantity: newFilled,
      remaining_quantity: newRemaining,
      status: newStatus,
      updated_at_utc: current_time_utc,
      fills: [...order.fills, fillEvent]
    };

    this.ordersById.set(order_id, updatedOrder);
    this.ordersByIntentId.set(order.intent_id, updatedOrder);
    return deepFreeze({ ...updatedOrder });
  }

  /**
   * Requests cancellation of an outstanding open order
   */
  public requestCancellation(order_id: string, current_time_utc: string): SimulatedOrderRecord {
    validateIso8601UtcTimestamp(current_time_utc);

    const order = this.ordersById.get(order_id);
    if (!order) {
      throw new Error(`E-ERR-024: ORDER_NOT_FOUND: Simulated order '${order_id}' does not exist`);
    }

    if (['FILLED', 'CANCELLED', 'REJECTED'].includes(order.status)) {
      throw new Error(`E-ERR-036: TERMINAL_ORDER_STATE: Cannot cancel order in terminal status '${order.status}'`);
    }

    const cancelledOrder: SimulatedOrderRecord = {
      ...order,
      status: 'CANCELLED',
      updated_at_utc: current_time_utc
    };

    this.ordersById.set(order_id, cancelledOrder);
    this.ordersByIntentId.set(order.intent_id, cancelledOrder);
    return deepFreeze({ ...cancelledOrder });
  }

  public getOrder(order_id: string): SimulatedOrderRecord | null {
    const order = this.ordersById.get(order_id);
    return order ? deepFreeze({ ...order }) : null;
  }

  public getOrderByIntentId(intent_id: string): SimulatedOrderRecord | null {
    const order = this.ordersByIntentId.get(intent_id);
    return order ? deepFreeze({ ...order }) : null;
  }
}
