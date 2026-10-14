# Velocity windows: in-memory ring buffer vs Redis sorted sets

Implementation: [`server/src/ds/slidingWindow.ts`](../server/src/ds/slidingWindow.ts) (exact, event-time, ring buffer per entity)
and [`server/src/rules/velocity.ts`](../server/src/rules/velocity.ts) (per card entity and device entity: count and amount in 1 h and 24 h, distinct card entities per device in 24 h).

Window rule: an event counts when `now - window < t <= now`. An event exactly one window old is out. Tests: [`server/test/slidingWindow.test.ts`](../server/test/slidingWindow.test.ts).

## Measured comparison

`node --expose-gc --import tsx server/scripts/benchVelocity.ts 100000 10000` on a MacBook (Apple silicon), Redis 7 in Docker on the same machine, 13 October 2026. Both sides compute 1 h and 24 h count and sum per event.

| | In-memory `SlidingWindow` | Redis sorted set per entity |
|---|---|---|
| Time per event | 0.4 µs | 520 µs (one MULTI round trip) |
| Memory for ~3.8K active entities | ~2.3 MB of V8 heap | ~1.2 MB of Redis memory |
| Accuracy | exact | exact (results matched) |
| Survives an API restart | no; rebuild by replaying the last 24 h | yes |
| Shared by several API instances | no | yes |
| Sum of amounts | O(events in window) in process | needs ZRANGEBYSCORE and parsing members, or a second structure |

## Trade-off

- In-memory is about 1,000x faster because it avoids a network round trip, and the 24 h retention bound keeps memory proportional to recent activity, not history.
- Redis wins when there is more than one API instance or when a restart must not lose state. Its cost is latency per request, and amounts must be packed into members (`id:amount`) to be summed.
- A middle ground for scale-out: shard entities to instances by key hash so each instance owns its windows in memory, and rebuild a shard on restart from the last 24 h of `transactions` in PostgreSQL.
- Out-of-order events: the window keeps events in time order and inserts late arrivals in place. An event more than 24 h older than the newest one seen for that entity is ignored. With `replay.py --concurrency 1` events arrive in order and runs are exactly reproducible.

This project runs one API instance, so it uses the in-memory window.
