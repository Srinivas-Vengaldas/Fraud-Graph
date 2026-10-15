# Write-up, demo script and resume bullets

Drafts. Every bracket is filled only from a measured number in [results.md](results.md) or [load.md](load.md) after the real IEEE-CIS run. Delete any line that cannot be reproduced.

## Post draft: "What 590K real transactions taught me about fraud rings"

**The setup.** I built a real-time fraud engine on the IEEE-CIS dataset: about 590,000 anonymized e-commerce transactions from Vesta, 3.5% fraud. Each transaction gets approve, review or decline in under 2 ms of scoring time (p95), with reasons.

**Lesson 1: the "customer" is a hypothesis.** The dataset has no customer id. Combining card1, the billing region and the card's first-use day (TransactionDT minus D1) gives a key whose labels agree 96.6% of the time, against 84.8% for card1 alone. I treated that as a hypothesis and tested it, rather than assuming it.

**Lesson 2: one shared value can merge everyone.** Linking cards that share a device looks like ring detection until generic device strings join 63,586 entities into one ring. Capping node degree at 50 and rebuilding union-find without the cut nodes took ring lift from 2.4x to 2.9x on the holdout, but a 22,598-entity ring survives: medium-degree devices chain together. A cap of 5 shrinks the largest ring to 918 and lifts it to 4.7x, at the cost of catching less fraud.

**Lesson 3: the labels flatter the blocklist.** After a chargeback, the competition labeled the card's later transactions as fraud. A blocklist of training-period fraud therefore looks brilliant. I delayed every label by seven days in event time and still say plainly how much of the win comes from the labeling rule.

**Lesson 4: decide in dollars, within what a team can do.** Left unconstrained, a $5 review cost makes it worth reviewing a quarter of all transactions, which no team can staff. With reviews capped at 2% of daily volume and auto-declines at 1%, the model alone caught 51.0% of fraud at a 0.81% false-positive rate and saved $221,658 on the holdout, against 21.4% and $105,767 for the rules at the same workload. Run live, with the API spending its daily review budget on the highest scores it sees, the system caught 45.7% of fraud at a 0.77% false-positive rate and saved $190,013.
