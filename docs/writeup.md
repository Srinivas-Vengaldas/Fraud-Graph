# Write-up, demo script and resume bullets

Drafts. Every bracket is filled only from a measured number in [results.md](results.md) or [load.md](load.md) after the real IEEE-CIS run. Delete any line that cannot be reproduced.

## Post draft: "What 590K real transactions taught me about fraud rings"

**The setup.** I built a real-time fraud engine on the IEEE-CIS dataset: about 590,000 anonymized e-commerce transactions from Vesta, 3.5% fraud. Each transaction gets approve, review or decline in under 2 ms of scoring time (p95), with reasons.

**Lesson 1: the "customer" is a hypothesis.** The dataset has no customer id. Combining card1, the billing region and the card's first-use day (TransactionDT minus D1) gives a key whose labels agree 96.6% of the time, against 84.8% for card1 alone. I treated that as a hypothesis and tested it, rather than assuming it.

**Lesson 2: one shared value can merge everyone.** Linking cards that share a device looks like ring detection until generic device strings join 63,586 entities into one ring. Capping node degree at 50 and rebuilding union-find without the cut nodes took ring lift from 2.4x to 2.9x on the holdout, but a 22,598-entity ring survives: medium-degree devices chain together. A cap of 5 shrinks the largest ring to 918 and lifts it to 4.7x, at the cost of catching less fraud.

**Lesson 3: the labels flatter the blocklist.** After a chargeback, the competition labeled the card's later transactions as fraud. A blocklist of training-period fraud therefore looks brilliant. I delayed every label by seven days in event time and still say plainly how much of the win comes from the labeling rule.

**Lesson 4: decide in dollars, within what a team can do.** Left unconstrained, a $5 review cost makes it worth reviewing a quarter of all transactions, which no team can staff. With reviews capped at 2% of daily volume and auto-declines at 1%, the model alone caught 51.0% of fraud at a 0.81% false-positive rate and saved $221,658 on the holdout, against 21.4% and $105,767 for the rules at the same workload. Run live, with the API spending its daily review budget on the highest scores it sees, the system caught 45.7% of fraud at a 0.77% false-positive rate and saved $190,013.

**What I would do next.** Tune the supernode cap and rule thresholds on a validation window instead of using the guide's defaults, and retrain on a rolling window as analyst labels arrive.

## Demo video outline (2–3 minutes)

Recorded: [docs/media/demo.mp4](media/demo.mp4) (silent, captioned).

Before recording: `docker compose up -d db redis`, start the API (`make api` or `cd server && node dist/index.js`), and open http://localhost:3000. Use QuickTime → New Screen Recording, or Cmd+Shift+5.

1. **The problem (20 s).** README top: card-not-present fraud, both kinds of mistake cost money, so results are in dollars.
2. **One transaction end to end (60 s).** In a terminal:
   ```
   curl -s localhost:3000/v1/score -H 'content-type: application/json' -H 'Idempotency-Key: demo-1' \
     -d '{"TransactionID": 7000000001, "TransactionDT": 15800000, "TransactionAmt": 249.99, "ProductCD": "C",
          "card1": 9500, "addr1": 299, "D1": 0, "C1": 9, "C14": 4, "P_emaildomain": "anonymous.com"}' | jq
   ```
   Point at the verdict, score and reasons. Run the same command again: identical answer, served from the idempotency store. Change only the amount with the same key: 422.
3. **The analyst view (40 s).** Review queue sorted by risk; open a case, read its reasons, click "Open ring", show the graph, the red prior-fraud borders, and re-centering on a node.
4. **The results (40 s).** README tables: rules vs model at the same analyst capacity, ring lift with and without the supernode cap, latency. Close on the one-line takeaway: at 2% review capacity the model doubles net savings over rules.

Afterwards remove the demo row: `docker compose exec -T db psql -U fraudgraph -d fraudgraph -c "DELETE FROM reviews WHERE transaction_id=7000000001; DELETE FROM features WHERE transaction_id=7000000001; DELETE FROM decisions WHERE transaction_id=7000000001; DELETE FROM transactions WHERE transaction_id=7000000001;"`

## Resume bullets (fill only with measured values)

- Built a real-time fraud-scoring API in TypeScript/Fastify on 590K real anonymized e-commerce transactions (IEEE-CIS/Vesta), sustaining 950 req/s locally with 1.8 ms p95 scoring latency and idempotent, exactly-once decisions
- Implemented a Bloom-filter blocklist, sliding-window velocity rules and union-find identity rings with supernode capping; risky rings showed 2.9x the baseline fraud rate on a time-based holdout
- Trained LightGBM served via ONNX in Node (Python/Node parity within 1e-5); at a fixed 2% daily analyst capacity it caught 51% of holdout fraud vs 21% for rules alone, doubling net savings to $222K under stated review-cost and margin assumptions

## Interview notes

- Time split vs random split: random would let a card's future fraud train the model that scores its past, inflating every metric.
- Blocklist strength: partly the labeling rule; show the seven-day label delay and the "prior fraud on another entity only" ring column.
- Parallel retries: the first request wins `SET NX`; the others wait for the stored body or get 409 if it is still computing; a different body under the same key gets 422.
- Training-serving skew: the entity-key parity test (Python vs TypeScript) and the ONNX parity test (LightGBM vs onnxruntime-node), both on 1,000 rows in CI.
- Scaling to 10K TPS: shard entities by key hash so each instance owns its windows and ring partition, move idempotency to a Redis cluster, batch the PostgreSQL writes, and rebuild a shard from the last 24 h on restart.
