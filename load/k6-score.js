// Load test for POST /v1/score at fixed concurrency.
//
//   python load/make_bodies.py            # realistic bodies from the holdout
//   k6 run -e BASE_URL=http://localhost:3000 -e BODIES=data/clean/k6_bodies.json load/k6-score.js
//
// Each request gets a unique TransactionID (from 8,000,000,000 up) and Idempotency-Key,
// so every call is scored fresh. Remove the rows afterwards with load/cleanup.sql.
import http from "k6/http";
import { check } from "k6";
import { SharedArray } from "k6/data";
import exec from "k6/execution";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const VUS = Number(__ENV.VUS || 20);
const DURATION = __ENV.DURATION || "60s";
const RUN = Number(__ENV.RUN_ID || Math.floor(Date.now() / 1000) % 100000);

const bodies = new SharedArray("bodies", () => JSON.parse(open(__ENV.BODIES || "../data/clean/k6_bodies.json")));

export const options = {
  scenarios: {
    fixed_concurrency: { executor: "constant-vus", vus: VUS, duration: DURATION },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<50"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export default function () {
  const i = exec.scenario.iterationInTest;
  const body = Object.assign({}, bodies[i % bodies.length]);
  body.TransactionID = 8_000_000_000 + RUN * 1_000_000 + i;
  const res = http.post(`${BASE_URL}/v1/score`, JSON.stringify(body), {
    headers: { "content-type": "application/json", "idempotency-key": `k6-${body.TransactionID}` },
  });
  check(res, { "status is 200": (r) => r.status === 200 });
}
