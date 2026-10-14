// Compare the in-memory SlidingWindow with Redis sorted sets for per-card velocity.
// Usage: npx tsx scripts/benchVelocity.ts [events] [entities]
import { Redis } from "ioredis";
import { config } from "../src/config.js";
import { SlidingWindow } from "../src/ds/slidingWindow.js";

const N = Number(process.argv[2] ?? 100_000);
const ENTITIES = Number(process.argv[3] ?? 10_000);
const HOUR = 3600;
const DAY = 86_400;

let seed = 1;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
// About 4 days of traffic, entities drawn with a skew so some are busy.
const events = Array.from({ length: N }, (_, i) => ({
  id: i,
  t: Math.floor((i / N) * 4 * DAY),
  card: `card${Math.floor(rand() ** 2 * ENTITIES)}`,
  amt: Math.round(rand() * 20000) / 100,
}));

function bench(name: string, fn: () => Promise<void> | void) {
  return (async () => {
    const t0 = performance.now();
    await fn();
    const ms = performance.now() - t0;
    console.log(`${name}: ${ms.toFixed(0)} ms total, ${((ms * 1000) / N).toFixed(1)} µs/event`);
    return ms;
  })();
}

// In-memory
global.gc?.();
const heap0 = process.memoryUsage().heapUsed;
const windows = new Map<string, SlidingWindow>();
let memCheck = 0;
await bench("in-memory SlidingWindow", () => {
  for (const e of events) {
    let w = windows.get(e.card);
    if (!w) windows.set(e.card, (w = new SlidingWindow(DAY)));
    w.add(e.t, e.amt);
    memCheck += w.count(e.t, HOUR) + w.count(e.t, DAY) + w.sum(e.t, HOUR) + w.sum(e.t, DAY);
  }
});
global.gc?.();
const heapMb = (process.memoryUsage().heapUsed - heap0) / 1e6;
console.log(`  heap growth ~${heapMb.toFixed(1)} MB for ${windows.size} entities`);

// Redis sorted sets: member = "<id>:<amount>", score = event time.
const redis = new Redis(config.redisUrl());
const prefix = `bench:vel:${Date.now()}:`;
const mem0 = Number(/used_memory:(\d+)/.exec(await redis.info("memory"))![1]);
let redisCheck = 0;
await bench("Redis ZADD + ZREMRANGEBYSCORE + ZCOUNT/ZRANGEBYSCORE (1 round trip per event)", async () => {
  for (const e of events) {
    const k = prefix + e.card;
    const res = await redis
      .multi()
      .zadd(k, e.t, `${e.id}:${e.amt}`)
      .zremrangebyscore(k, "-inf", e.t - DAY)
      .zcount(k, `(${e.t - HOUR}`, e.t)
      .zcount(k, `(${e.t - DAY}`, e.t)
      .zrangebyscore(k, `(${e.t - HOUR}`, e.t)
      .zrangebyscore(k, `(${e.t - DAY}`, e.t)
      .expire(k, DAY)
      .exec();
    const sum = (m: string[]) => m.reduce((s, x) => s + Number(x.split(":")[1]), 0);
    redisCheck += (res![2]![1] as number) + (res![3]![1] as number) + sum(res![4]![1] as string[]) + sum(res![5]![1] as string[]);
  }
});
const mem1 = Number(/used_memory:(\d+)/.exec(await redis.info("memory"))![1]);
console.log(`  Redis memory growth ~${((mem1 - mem0) / 1e6).toFixed(1)} MB`);
console.log(`results agree: ${Math.abs(memCheck - redisCheck) < 1e-6 * Math.abs(memCheck)}`);

let cursor = "0";
do {
  const [next, keys] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 1000);
  if (keys.length) await redis.del(...keys);
  cursor = next;
} while (cursor !== "0");
redis.disconnect();
