import {
  CanonicalMoney,
  createCanonicalMoney,
  CanonicalOffer,
  validateIso8601UtcTimestamp
} from '../canonical/domain.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import { sha256 } from '../canonical/crypto.js';
import { deepFreeze } from '../verification/gate.js';
import { NormalizedMarketFeedEvent } from '../feeds/feedHandler.js';

export type ExecutionIntentDecisionStatus =
  | 'EXECUTE_DRY_RUN'
  | 'SKIP_NO_SPREAD'
  | 'SKIP_STALE_FEED'
  | 'SKIP_UNVERIFIED_OFFER'
  | 'SKIP_EXPIRED_OFFER'
  | 'SKIP_MOQ_MISMATCH';

export interface ExecutionEngineOptions {
  minimumSpreadSubunits?: bigint;
  maxStaleFeedAgeMs?: number;
  engineRelease?: string;
}

export interface ExecutionIntentPayload {
  intent_id: string;
  engine_release: string;
  mode: 'DRY_RUN';
  offer_id: string;
  product_id: string;
  venue_id: string;
  target_side: 'BUY' | 'SELL';
  offer_unit_price: CanonicalMoney;
  market_unit_price: CanonicalMoney;
  order_quantity: number;
  gross_notional: CanonicalMoney;
  expected_gross_margin_subunits: string;
  decision_status: ExecutionIntentDecisionStatus;
  decision_reason: string;
  evaluated_at_utc: string;
  market_event_sha256: string;
}

export interface ExecutionIntent {
  payload: ExecutionIntentPayload;
  canonical_intent_sha256: string;
}

export class DryRunExecutionEngine {
  private engineRelease: string;
  private defaultMaxStaleFeedAgeMs: number;
  private defaultMinimumSpreadSubunits: bigint;

  constructor(options?: ExecutionEngineOptions) {
    this.engineRelease = options?.engineRelease ?? 'GATE-M2-EXEC-v0.1.0';
    this.defaultMaxStaleFeedAgeMs = options?.maxStaleFeedAgeMs ?? 300_000;
    this.defaultMinimumSpreadSubunits = options?.minimumSpreadSubunits ?? 0n;
  }

  public evaluateExecutionIntent(
    offer: CanonicalOffer,
    feed: NormalizedMarketFeedEvent,
    evaluated_at_utc: string,
    options?: ExecutionEngineOptions
  ): ExecutionIntent {
    validateIso8601UtcTimestamp(evaluated_at_utc);

    if (offer.product_id !== feed.product_id) {
      throw new Error(`E-ERR-028: PRODUCT_MISMATCH: Offer product '${offer.product_id}' does not match market feed product '${feed.product_id}'`);
    }

    const intentId = `intent:dryrun:${feed.venue_id}:${offer.offer_id}:${feed.stream_sequence}:${Date.parse(evaluated_at_utc)}`;
    const maxAge = options?.maxStaleFeedAgeMs ?? this.defaultMaxStaleFeedAgeMs;
    const minSpread = options?.minimumSpreadSubunits ?? this.defaultMinimumSpreadSubunits;
    const release = options?.engineRelease ?? this.engineRelease;

    // 1. Offer Status & Verification Status Check
    if (offer.offer_status !== 'VERIFIED_EXECUTABLE_OFFER' || offer.verification_status !== 'VERIFIED') {
      return this.createIntentResult({
        intentId,
        release,
        offer,
        feed,
        evaluated_at_utc,
        status: 'SKIP_UNVERIFIED_OFFER',
        reason: `Offer '${offer.offer_id}' requires offer_status 'VERIFIED_EXECUTABLE_OFFER' and verification_status 'VERIFIED' (got offer_status '${offer.offer_status}', verification_status '${offer.verification_status}')`,
        quantity: 0,
        marginSubunits: '0'
      });
    }

    // 2. Offer Expiration Check
    const evalMs = Date.parse(evaluated_at_utc);
    const offerExpMs = Date.parse(offer.valid_until_utc);
    if (evalMs > offerExpMs) {
      return this.createIntentResult({
        intentId,
        release,
        offer,
        feed,
        evaluated_at_utc,
        status: 'SKIP_EXPIRED_OFFER',
        reason: `Offer '${offer.offer_id}' expired at ${offer.valid_until_utc} (evaluated at ${evaluated_at_utc})`,
        quantity: 0,
        marginSubunits: '0'
      });
    }

    // 3. Market Feed Status & Freshness Check
    if (feed.feed_status !== 'ACTIVE') {
      return this.createIntentResult({
        intentId,
        release,
        offer,
        feed,
        evaluated_at_utc,
        status: 'SKIP_STALE_FEED',
        reason: `Market feed for '${feed.venue_id}:${feed.product_id}' is not ACTIVE (status '${feed.feed_status}')`,
        quantity: 0,
        marginSubunits: '0'
      });
    }

    const feedAgeMs = evalMs - Date.parse(feed.occurred_at_utc);
    if (feedAgeMs > maxAge || feedAgeMs < 0) {
      return this.createIntentResult({
        intentId,
        release,
        offer,
        feed,
        evaluated_at_utc,
        status: 'SKIP_STALE_FEED',
        reason: `Market feed event age ${feedAgeMs}ms exceeds freshness limit ${maxAge}ms`,
        quantity: 0,
        marginSubunits: '0'
      });
    }

    // 4. Quantity and MOQ Verification
    if (feed.bid_quantity < offer.minimum_order_quantity) {
      return this.createIntentResult({
        intentId,
        release,
        offer,
        feed,
        evaluated_at_utc,
        status: 'SKIP_MOQ_MISMATCH',
        reason: `Market venue bid quantity ${feed.bid_quantity} is less than offer MOQ ${offer.minimum_order_quantity}`,
        quantity: 0,
        marginSubunits: '0'
      });
    }

    const executableQuantity = Math.min(
      feed.bid_quantity,
      offer.available_quantity !== undefined ? offer.available_quantity : feed.bid_quantity
    );

    if (executableQuantity < offer.minimum_order_quantity) {
      return this.createIntentResult({
        intentId,
        release,
        offer,
        feed,
        evaluated_at_utc,
        status: 'SKIP_MOQ_MISMATCH',
        reason: `Executable quantity ${executableQuantity} does not meet offer MOQ ${offer.minimum_order_quantity}`,
        quantity: 0,
        marginSubunits: '0'
      });
    }

    // 5. Currency Compatibility & Spread Calculation
    if (offer.unit_price.currency !== feed.bid_price.currency) {
      throw new Error(`E-ERR-011: CROSS_CURRENCY_NOT_SUPPORTED: Offer currency '${offer.unit_price.currency}' does not match feed currency '${feed.bid_price.currency}'`);
    }

    const offerSubunits = BigInt(offer.unit_price.amount_subunits);
    const marketBidSubunits = BigInt(feed.bid_price.amount_subunits);
    const spreadPerUnit = marketBidSubunits - offerSubunits;
    const totalMargin = spreadPerUnit * BigInt(executableQuantity);

    if (spreadPerUnit <= minSpread) {
      return this.createIntentResult({
        intentId,
        release,
        offer,
        feed,
        evaluated_at_utc,
        status: 'SKIP_NO_SPREAD',
        reason: `Market bid ${marketBidSubunits} gives insufficient spread (${spreadPerUnit} subunits <= minimum ${minSpread} subunits) over offer price ${offerSubunits}`,
        quantity: executableQuantity,
        marginSubunits: totalMargin.toString()
      });
    }

    // 6. Profitable Crossing Opportunity Found: Generate DRY_RUN Execution Intent
    return this.createIntentResult({
      intentId,
      release,
      offer,
      feed,
      evaluated_at_utc,
      status: 'EXECUTE_DRY_RUN',
      reason: `Profitable crossing opportunity identified: bid ${marketBidSubunits} exceeds offer ${offerSubunits} by ${spreadPerUnit} subunits/unit across ${executableQuantity} units`,
      quantity: executableQuantity,
      marginSubunits: totalMargin.toString()
    });
  }

  private createIntentResult(params: {
    intentId: string;
    release: string;
    offer: CanonicalOffer;
    feed: NormalizedMarketFeedEvent;
    evaluated_at_utc: string;
    status: ExecutionIntentDecisionStatus;
    reason: string;
    quantity: number;
    marginSubunits: string;
  }): ExecutionIntent {
    const marketPrice = params.feed.bid_price;
    const grossNotionalSubunits = (BigInt(marketPrice.amount_subunits) * BigInt(params.quantity)).toString();
    const grossNotional = createCanonicalMoney(grossNotionalSubunits, marketPrice.currency, marketPrice.scale);

    const payload: ExecutionIntentPayload = {
      intent_id: params.intentId,
      engine_release: params.release,
      mode: 'DRY_RUN',
      offer_id: params.offer.offer_id,
      product_id: params.offer.product_id,
      venue_id: params.feed.venue_id,
      target_side: 'SELL',
      offer_unit_price: params.offer.unit_price,
      market_unit_price: params.feed.bid_price,
      order_quantity: params.quantity,
      gross_notional: grossNotional,
      expected_gross_margin_subunits: params.marginSubunits,
      decision_status: params.status,
      decision_reason: params.reason,
      evaluated_at_utc: params.evaluated_at_utc,
      market_event_sha256: params.feed.event_sha256
    };

    const canonicalBytes = Buffer.from(canonicalizeJCS(payload), 'utf8');
    const canonical_intent_sha256 = sha256(canonicalBytes);

    return deepFreeze({
      payload,
      canonical_intent_sha256
    });
  }
}
