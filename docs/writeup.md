# Write-up, demo script and resume bullets

Drafts. Every bracket is filled only from a measured number in [results.md](results.md) or [load.md](load.md) after the real IEEE-CIS run. Delete any line that cannot be reproduced.

## Post draft: "What 590K real transactions taught me about fraud rings"

**The setup.** I built a real-time fraud engine on the IEEE-CIS dataset: about 590,000 anonymized e-commerce transactions from Vesta, 3.5% fraud. Each transaction gets approve, review or decline in [p95] ms, with reasons.

**Lesson 1: the "customer" is a hypothesis.** The dataset has no customer id. Combining card1, the billing region and the card's first-use day (TransactionDT minus D1) gives a key whose labels agree 96.6% of the time, against 84.8% for card1 alone. I treated that as a hypothesis and tested it, rather than assuming it.

**Lesson 2: one shared value can merge everyone.** Linking cards that share a device looks like ring detection until generic device strings join 63,586 entities into one ring. Capping node degree at 50 and rebuilding union-find without the cut nodes took ring lift from 2.4x to 2.9x on the holdout, but a 22,598-entity ring survives: medium-degree devices chain together. A cap of 5 shrinks the largest ring to 918 and lifts it to 4.7x, at the cost of catching less fraud.

**Lesson 3: the labels flatter the blocklist.** After a chargeback, the competition labeled the card's later transactions as fraud. A blocklist of training-period fraud therefore looks brilliant. I delayed every label by seven days in event time and still say plainly how much of the win comes from the labeling rule.

**Lesson 4: decide in dollars, within what a team can do.** Left unconstrained, a $5 review cost makes it worth reviewing a quarter of all transactions, which no team can staff. Capping reviews at 2% of daily volume and auto-declines at 1%, the model alone caught 51.0% of fraud with a 0.81% false-positive rate and saved $221,658 on the holdout, against 23.7% and $109,115 for the rules at the same workload. The blocklist rules decline too many good customers: $76,817 of the $79,693 wrongly declined comes from them.

**What I would do next.** [one or two honest next steps]

## Demo video outline (2–3 minutes)

1. The problem (20 s): card-not-present fraud, the cost of both kinds of mistake, the dollar framing.
2. One transaction end to end (60 s): send a request, show the decision and reasons, resend it with the same key and get the identical stored answer.
3. The ring explorer (40 s): open a review case, then its ring in two clicks; show a supernode being excluded.
4. The results (40 s): the README table (rules only, model only, both), ring lift with and without the cap, latency.

## Resume bullets (fill only with measured values)

- Built a real-time fraud-scoring API in TypeScript/Fastify on 590K real anonymized e-commerce transactions (IEEE-CIS/Vesta), scoring at [X] ms p95 and [N] req/s with idempotent, exactly-once decisions
- Implemented a Bloom-filter blocklist, sliding-window velocity rules and union-find identity rings with supernode capping; risky rings showed 2.9x the baseline fraud rate on a time-based holdout
- Trained LightGBM served via ONNX in Node, raising recall from [A]% (rules only) to [B]% at 1% FPR and saving $[Z] net on the holdout under stated review-cost and margin assumptions

## Interview notes

- Time split vs random split: random would let a card's future fraud train the model that scores its past, inflating every metric.
- Blocklist strength: partly the labeling rule; show the seven-day label delay and the "prior fraud on another entity only" ring column.
- Parallel retries: the first request wins `SET NX`; the others wait for the stored body or get 409 if it is still computing; a different body under the same key gets 422.
- Training-serving skew: the entity-key parity test (Python vs TypeScript) and the ONNX parity test (LightGBM vs onnxruntime-node), both on 1,000 rows in CI.
- Scaling to 10K TPS: shard entities by key hash so each instance owns its windows and ring partition, move idempotency to a Redis cluster, batch the PostgreSQL writes, and rebuild a shard from the last 24 h on restart.
