import type pg from "pg";
import type { ScoreResult, Scorer } from "../api/score.js";
import type { Transaction, Verdict } from "../api/schemas.js";
import { cardEntity, deviceEntity } from "../entities/keys.js";
import { node, RingGraph } from "../graph/rings.js";
import { Blocklist, type BlocklistEntry, type BlocklistHit } from "../rules/blocklist.js";
import { VelocityTracker, type VelocityFeatures } from "../rules/velocity.js";
import { buildFeatures, type FeatureVector } from "./features.js";
import { ReviewQueue } from "./reviewQueue.js";

// Signals run cheapest first: blocklist (Bloom filter, then PostgreSQL on a hit),
// velocity windows, identity ring, then the model. Every non-approve verdict
// carries human-readable reasons.

export interface ModelScorer {
  readonly version: string;
  score(features: FeatureVector, tx: Transaction): Promise<number> | number;
}

export interface RuleThresholds {
  deviceCards24h: number; // distinct card entities on one device in 24 h
  cardTx1h: number;
  cardAmt24h: number;
  ringSize: number; // ring at least this big ...
  ringFraudOthers: number; // ... with at least this many other entities with prior fraud
}

export const DEFAULT_RULES: RuleThresholds = {
  deviceCards24h: 4,
  cardTx1h: 4,
  cardAmt24h: 3000,
  ringSize: 3,
  ringFraudOthers: 1,
};

export type PolicyMode = "rules" | "model" | "rules+model";

export interface Policy {
  mode: PolicyMode;
  reviewThreshold: number; // model score at or above -> review
  declineThreshold: number; // model score at or above -> decline
}

export const DEFAULT_POLICY: Policy = { mode: "rules", reviewThreshold: 0.5, declineThreshold: 0.9 };

interface RuleOutcome {
  verdict: Verdict;
  reasons: string[];
  score: number; // rules-only risk in [0, 1], used for queue order when there is no model
}

const SEVERITY: Record<Verdict, number> = { approve: 0, review: 1, decline: 2 };
const money = (x: number) => `$${x.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export function applyRules(
  vel: VelocityFeatures,
  ring: { ring_size: number; ring_fraud_others: number },
  hits: BlocklistHit[],
  r: RuleThresholds = DEFAULT_RULES,
  deviceIsGeneric = false,
): RuleOutcome {
  const decline: string[] = [];
  const review: string[] = [];
  for (const h of hits) {
    if (h.entity_type === "card") decline.push(`card entity on blocklist (${h.reason})`);
    else review.push(`device on blocklist (${h.reason})`);
  }
  if (ring.ring_size >= r.ringSize && ring.ring_fraud_others >= r.ringFraudOthers) {
    review.push(`identity ring of ${ring.ring_size} entities includes ${ring.ring_fraud_others} with prior fraud`);
  }
  // A generic device string ("Windows|Windows 10|chrome|1920x1080") is shared by
  // design; many cards on it says nothing. Only specific fingerprints count.
  if (!deviceIsGeneric && vel.device_cards_24h !== null && vel.device_cards_24h >= r.deviceCards24h) {
    review.push(`device linked to ${vel.device_cards_24h} card entities in 24 h`);
  }
  if (vel.card_tx_1h >= r.cardTx1h) review.push(`${vel.card_tx_1h} transactions on this card in 1 h`);
  if (vel.card_amt_24h >= r.cardAmt24h) review.push(`${money(vel.card_amt_24h)} on this card in 24 h`);

  if (decline.length > 0) return { verdict: "decline", reasons: [...decline, ...review], score: 1 };
  if (review.length > 0) return { verdict: "review", reasons: review, score: Math.min(0.95, 0.5 + 0.15 * (review.length - 1)) };
  return { verdict: "approve", reasons: [], score: 0 };
}

export function combine(
  rules: RuleOutcome,
  modelScore: number | null,
  policy: Policy,
): { verdict: Verdict; reasons: string[]; score: number } {
  let modelVerdict: Verdict = "approve";
  const modelReasons: string[] = [];
  if (modelScore !== null) {
    if (modelScore >= policy.declineThreshold) modelVerdict = "decline";
    else if (modelScore >= policy.reviewThreshold) modelVerdict = "review";
    if (modelVerdict !== "approve") {
      const t = modelVerdict === "decline" ? policy.declineThreshold : policy.reviewThreshold;
      modelReasons.push(`model risk score ${modelScore.toFixed(2)} (${modelVerdict} threshold ${t.toFixed(2)})`);
    }
  }
  const score = modelScore ?? rules.score;
  if (policy.mode === "rules" || modelScore === null) return { verdict: rules.verdict, reasons: rules.reasons, score };
  if (policy.mode === "model") return { verdict: modelVerdict, reasons: modelReasons, score };
  const verdict = SEVERITY[modelVerdict] > SEVERITY[rules.verdict] ? modelVerdict : rules.verdict;
  return { verdict, reasons: [...rules.reasons, ...modelReasons], score };
}

export interface EngineOptions {
  degreeCap?: number | null;
  rules?: RuleThresholds;
  policy?: Policy;
  model?: ModelScorer | null;
  log?: (msg: string) => void;
}

export class RiskEngine implements Scorer {
  readonly velocity = new VelocityTracker();
  readonly rings: RingGraph;
  private pendingMarks: BlocklistEntry[];
  private nextMark = 0;
  policy: Policy;
  model: ModelScorer | null;

  private constructor(
    readonly blocklist: Blocklist,
    readonly reviews: ReviewQueue,
    private readonly opts: EngineOptions,
  ) {
    this.rings = new RingGraph({
      degreeCap: opts.degreeCap === undefined ? 50 : opts.degreeCap,
      onSupernode: (n, deg) => opts.log?.(`supernode cut from ring graph: ${n} (degree ${deg})`),
    });
    this.policy = opts.policy ?? DEFAULT_POLICY;
    this.model = opts.model ?? null;
    // Prior fraud enters the ring graph only once its label exists in event time.
    this.pendingMarks = [...blocklist.entries].sort((a, b) => (a.effective_dt ?? -Infinity) - (b.effective_dt ?? -Infinity));
  }

  static async create(pool: pg.Pool, opts: EngineOptions = {}): Promise<RiskEngine> {
    const [blocklist, reviews] = await Promise.all([Blocklist.load(pool), ReviewQueue.load(pool)]);
    return new RiskEngine(blocklist, reviews, opts);
  }

  get modelVersion(): string {
    return this.model && this.policy.mode !== "rules" ? this.model.version : "none";
  }

  private advanceTo(t: number): void {
    while (this.nextMark < this.pendingMarks.length) {
      const e = this.pendingMarks[this.nextMark]!;
      if (e.effective_dt !== null && e.effective_dt > t) break;
      this.rings.markFraud(node(e.entity_type, e.entity_key));
      this.nextMark++;
    }
  }

  /**
   * Rebuild in-memory state (velocity windows, ring graph) from stored transactions,
   * in event-time order, without re-scoring. Called at startup so a restart does
   * not forget the graph. Returns the number of transactions applied.
   */
  async warmUp(pool: pg.Pool, batch = 20_000): Promise<number> {
    let n = 0;
    let lastDt = -1;
    let lastId = -1;
    for (;;) {
      const { rows } = await pool.query<{
        transaction_id: number; transaction_dt: number; amount: number; card1: number | null; addr1: number | null;
        d1: number | null; device_info: string | null; id_30: string | null; id_31: string | null; id_33: string | null;
      }>(
        `SELECT transaction_id, transaction_dt, amount, card1, addr1, d1, device_info, id_30, id_31, id_33
         FROM transactions WHERE (transaction_dt, transaction_id) > ($1, $2)
         ORDER BY transaction_dt, transaction_id LIMIT $3`,
        [lastDt, lastId, batch],
      );
      for (const r of rows) {
        const tx = {
          TransactionDT: r.transaction_dt, card1: r.card1, addr1: r.addr1, D1: r.d1,
          DeviceInfo: r.device_info, id_30: r.id_30, id_31: r.id_31, id_33: r.id_33,
        };
        this.advanceTo(r.transaction_dt);
        const card = cardEntity(tx);
        const device = deviceEntity(tx);
        this.velocity.observe(r.transaction_dt, r.amount, card, device);
        this.rings.addTransaction(card, device);
      }
      n += rows.length;
      if (rows.length < batch) return n;
      lastDt = rows[rows.length - 1]!.transaction_dt;
      lastId = rows[rows.length - 1]!.transaction_id;
    }
  }

  /** Analyst label: blocklist the case's entities from now on and mark them in the ring graph. */
  async labelFraud(card: string, device: string | null, reason: string): Promise<void> {
    await this.blocklist.add("card", card, reason);
    this.rings.markFraud(node("card", card));
    if (device !== null) {
      await this.blocklist.add("device", device, reason);
      this.rings.markFraud(node("device", device));
    }
  }

  async score(tx: Transaction): Promise<ScoreResult> {
    const t = tx.TransactionDT;
    this.advanceTo(t);
    const card = cardEntity(tx);
    const device = deviceEntity(tx);

    const entities: { type: "card" | "device"; key: string }[] = [{ type: "card", key: card }];
    if (device !== null) entities.push({ type: "device", key: device });
    const hits = await this.blocklist.check(entities, t);
    const vel = this.velocity.observe(t, tx.TransactionAmt, card, device);
    const ring = this.rings.addTransaction(card, device);
    const features = buildFeatures(tx, vel, ring, hits, device !== null);
    features.device_generic = device !== null && this.rings.isSupernode(node("device", device)) ? 1 : 0;

    const useModel = this.model !== null && this.policy.mode !== "rules";
    const modelScore = useModel ? await this.model!.score(features, tx) : null;
    const deviceIsGeneric = device !== null && this.rings.isSupernode(node("device", device));
    const rules = applyRules(vel, ring, hits, this.opts.rules, deviceIsGeneric);
    const { verdict, reasons, score } = combine(rules, modelScore, this.policy);

    // Training reads these logs: always the full vector, plus what the rules alone decided.
    const logged: FeatureVector = { ...features, rules_verdict: SEVERITY[rules.verdict], rules_score: rules.score, model_score: modelScore };

    const review =
      verdict === "review"
        ? { transaction_id: tx.TransactionID, score, reasons, card_entity: card, device_entity: device }
        : null;
    return {
      verdict,
      score: Math.round(score * 1e6) / 1e6,
      reasons,
      model_version: useModel ? this.model!.version : "none",
      features: logged,
      review,
      onCommit: review
        ? () =>
            this.reviews.push({
              ...review,
              amount: tx.TransactionAmt,
              transaction_dt: t,
              created_at: new Date().toISOString(),
            })
        : undefined,
    };
  }
}
