// Daily analyst capacity for the live review queue.
//
// A team can review only `share` of each day's transactions. Budget for a day is
// share x the previous day's volume (the current day's running volume on the first
// day). To spend it on the riskiest cases rather than the earliest, a case is only
// admitted if its score clears the bar that would have selected exactly the budget
// from the previous day's candidates, and while the day's budget lasts.
// Days are event-time days (TransactionDT / 86400), so replays are reproducible.
export class ReviewBudget {
  private day = -1;
  private volume = 0;
  private admitted = 0;
  private candidates: number[] = [];
  private prevVolume: number | null = null;
  private bar = -Infinity;
  skipped = 0;

  constructor(readonly share: number) {}

  private roll(day: number): void {
    if (day === this.day) return;
    if (this.day >= 0) {
      const budget = Math.floor(this.share * this.volume);
      const sorted = this.candidates.sort((a, b) => b - a);
      this.bar = budget > 0 && sorted.length > budget ? sorted[budget - 1]! : -Infinity;
      this.prevVolume = this.volume;
    }
    this.day = day;
    this.volume = 0;
    this.admitted = 0;
    this.candidates = [];
  }

  /** Count one scored transaction at event time t. */
  observe(t: number): void {
    this.roll(Math.floor(t / 86_400));
    this.volume++;
  }

  /** A review candidate with this score: true if the queue takes it. */
  admit(score: number): boolean {
    this.candidates.push(score);
    const budget = Math.max(1, Math.floor(this.share * (this.prevVolume ?? this.volume)));
    if (this.admitted < budget && score >= this.bar) {
      this.admitted++;
      return true;
    }
    this.skipped++;
    return false;
  }
}
