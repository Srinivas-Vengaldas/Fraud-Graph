"""Business assumptions behind every dollar figure. Change them here, rerun, and every table updates.

COST_PER_REVIEW: analyst cost per manual review, in dollars.
MARGIN:          margin lost on a legitimate transaction that is declined (share of amount).
REVIEW_CATCHES_FRAUD: a reviewed fraud case is stopped by the analyst before money moves.
ANALYST_CAPACITY_SHARE: the largest share of each day's transactions the analyst team can review.
MAX_DECLINE_SHARE: the largest share of transactions the business will auto-decline. Margin alone makes a
                   false decline look cheap; in practice declined good customers churn, so declines are capped.
"""

COST_PER_REVIEW = 5.0
MARGIN = 0.10
REVIEW_CATCHES_FRAUD = True
ANALYST_CAPACITY_SHARE = 0.02
MAX_DECLINE_SHARE = 0.01


def net_dollars(fraud_amt_declined: float, fraud_amt_reviewed: float, n_reviews: int,
                legit_amt_declined: float, cost_per_review: float = COST_PER_REVIEW, margin: float = MARGIN) -> float:
    """net = fraud $ blocked - reviews * cost per review - legit $ declined * margin"""
    blocked = fraud_amt_declined + (fraud_amt_reviewed if REVIEW_CATCHES_FRAUD else 0.0)
    return blocked - n_reviews * cost_per_review - legit_amt_declined * margin
