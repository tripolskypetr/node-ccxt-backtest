# Timeframe Selection for Pine Indicators

## Goal

Pick the timeframe where the indicator detects meaningful state changes early enough to act, without generating noise.

---

## Metrics to Measure

For each candidate timeframe run the same indicator and collect:

| Metric | What it tells you |
|---|---|
| **flips** | How many times trend changed direction in the output window |
| **span** | Real time covered by the valid (post-warmup) output |
| **balance at flip** | How far the indicator was from neutral when it flipped — small value = noisy threshold crossing |
| **reaction delay** | How many bars/minutes after price moved before the flip fired |
| **warmup cost** | How much history you need to fetch before getting any signal |

---

## Evaluation Script Pattern

Write a temporary `scripts/_debug_tf_compare.mjs` that loops over candidate timeframes and prints the metrics. Delete after use.

```js
function analyze(label, trend, balance) {
  const nonZero = trend.filter((d) => d.value !== 0);
  const bull    = trend.filter((d) => d.value === 1).length;
  const bear    = trend.filter((d) => d.value === -1).length;
  const neutral = trend.filter((d) => d.value === 0).length;

  // trend flips among non-zero values only
  const vals  = nonZero.map((d) => d.value);
  const flips = vals.filter((v, i) => i > 0 && v !== vals[i - 1]).length;

  // balance range on valid (non-NaN) bars
  const balVals = balance.filter((d) => d.value !== null && !isNaN(d.value)).map((d) => d.value);
  const balMin  = balVals.length ? Math.min(...balVals).toFixed(1) : "N/A";
  const balMax  = balVals.length ? Math.max(...balVals).toFixed(1) : "N/A";

  // flip details: timestamp, direction, balance value at flip
  const flipDetails = [];
  for (let i = 1; i < nonZero.length; i++) {
    if (nonZero[i].value !== nonZero[i - 1].value) {
      const b   = balance.find((d) => d.time === nonZero[i].time);
      const bal = b && !isNaN(b.value) ? b.value.toFixed(1) : "N/A";
      flipDetails.push(
        `  ${new Date(nonZero[i].time).toISOString()} ${nonZero[i-1].value}→${nonZero[i].value} bal=${bal}`
      );
    }
  }

  // output span in hours
  const valid = trend.filter((d) => d.value !== 0);
  const spanH = valid.length > 1
    ? ((valid[valid.length - 1].time - valid[0].time) / 3600000).toFixed(1)
    : "0";

  const warmup = trend.findIndex((d) => d.value !== 0);

  console.log(`\n=== ${label} ===`);
  console.log(`Warmup: ${warmup} bars | Neutral: ${neutral} | Bull: ${bull} | Bear: ${bear}`);
  console.log(`Flips: ${flips} | Balance: [${balMin} .. ${balMax}] | Span: ${spanH}h`);
  if (flipDetails.length) console.log("Flips:\n" + flipDetails.join("\n"));
  console.log(`Last 5: [${trend.slice(-5).map((d) => d.value).join(", ")}]`);
}

for (const tf of ["1m", "3m", "5m", "15m"]) {
  const plots = await run(
    File.fromPath("my_indicator.pine", "./math"),
    { symbol: "BTCUSDT", timeframe: tf, limit: 600 },
    "ccxt-exchange",
    new Date("2025-09-24T12:00:00.000Z"),
  );
  analyze(tf, plots["Trend"].data, plots["Balance"].data);
}
```

To add flip context (price ±5 bars around each flip):

```js
function printFlipContext(label, trend, balance, close) {
  console.log(`\n=== ${label} — flip context ===`);
  for (let i = 1; i < trend.length; i++) {
    if (trend[i].value !== trend[i-1].value && trend[i].value !== 0 && trend[i-1].value !== 0) {
      const from = Math.max(0, i - 5);
      const to   = Math.min(trend.length - 1, i + 5);
      console.log(`\nFlip ${trend[i-1].value}→${trend[i].value} @ ${new Date(trend[i].time).toISOString()}`);
      console.log("  bar | timestamp            | close       | balance | trend");
      for (let j = from; j <= to; j++) {
        const cl  = close.find((d) => d.time === trend[j].time);
        const bal = balance.find((d) => d.time === trend[j].time);
        const clv  = cl  && !isNaN(cl.value)  ? cl.value.toFixed(2)  : "N/A";
        const balv = bal && !isNaN(bal.value) ? bal.value.toFixed(0) : "N/A";
        console.log(
          `  ${String(j).padStart(3)} | ${new Date(trend[j].time).toISOString()} | ${String(clv).padStart(11)} | ${String(balv).padStart(7)} | ${trend[j].value}${j === i ? " <--" : ""}`
        );
      }
    }
  }
}
```

---

## Decision Rules

**Too fast (noisy)**
- Many flips over short span (e.g. 3+ flips in 8h on 1m)
- Balance at flip is at or just above the minimum threshold (e.g. 3 when minBalance=3)
- Flips cancel each other within a few bars

**Too slow (lagging)**
- Zero or one flip over a span of days
- Balance is deeply one-sided for the entire window — never crosses threshold in time
- By the time it flips, price has already moved significantly

**Good fit**
- 2–4 flips per ~24–48h span
- Balance at flip is clearly above threshold (≥ 2× minBalance)
- Flip happens within a few bars of the actual price reversal
- Trend is stable between flips (not oscillating)

---

## Observed Results: extreme_direction_5m.pine, old params (BTC/USDT, Sep 2025)

period1=100, period2=200, period3=300, lookback=50 → warmup=350. limit=600, end=2025-09-24T12:00:00Z

| TF | Warmup | Flips | Span | Balance range | Balance at flips |
|---|---|---|---|---|---|
| 1m | 110 | 3 | 8.2h | [-16 .. +47] | +3, -3, +3 |
| 3m | 180 | 3 | 20.9h | [-40 .. +33] | +3, -3, +4 |
| **5m** | 117 | **3** | **40.2h** | [-23 .. +18] | **+4, -3, +3** |
| 15m | 102 | 0 | 99.3h | [-27 .. 0] | — |

Selected: 5m (at the time). 15m was too slow — zero flips over 99h, permanently bearish.

---

## Observed Results: extreme_direction_5m.pine, 4h-tuned params (BTC/USDT, Feb 2024)

period1=24 (2h), period2=48 (4h), period3=96 (8h), lookback=24 (2h) → warmup=120. limit=300, end=2024-02-02T20:00:00Z

| TF | Warmup | Flips | Span | Balance range | Notes |
|---|---|---|---|---|---|
| 1m | 40 | 4 | 4.3h | [-19..+16] | 4 flips in 4h — too noisy, bal at flip = ±3 (threshold) |
| 3m | 29 | 6 | 13.5h | [-16..+21] | 6 flips — noisy, 2 flips at bal=3 |
| 5m | 63 | 7 | 19.7h | [-11..+11] | 7 flips in 20h — too noisy for 4h positions |
| **15m** | 26 | **7** | **68.3h** | [-14..+18] | **1 flip per ~10h — good fit for 4h trade window** |

**Selected: 15m**

Reasoning:
- `1m/3m/5m` — all too noisy with short periods: multiple flips within a single 4h trade window
- `15m` — 7 flips over 68h (avg 1 flip per 10h), trend stable within a 4h window
- Balance at 15m flips: ±3-5, clearly above threshold

Trade-level verification (failed trades on 2024-02-02):

| Moment | Trend | Balance | Verdict |
|---|---|---|---|
| Signal1 long @ 10:30 | +1 | -1 | Entered with balance=-1 → **neutral zone, should be blocked** |
| Signal1 end @ 14:30 | -1 | -5 | Trend already flipped 1h before end |
| Signal2 short @ 16:05 | -1 | 0 | **Balance=0 → neutral zone, should be blocked** |
| Signal2 end @ 20:05 | +1 | +4 | Trend flipped, position reversed against short |

Root cause: both failed trades entered when `|balance| < 4` — balance was at or below threshold.
Fix: gate entries on `Math.abs(direction.balance) >= 4` in `outputNode`.

---

## When to Revisit Timeframe

- If you change `period1/2/3` or `countLookback` significantly — warmup changes, re-run comparison
- If trading a different asset (higher/lower volatility) — flip frequency changes
- If market regime changes (trending vs ranging) — a TF that worked in one regime may break in another
