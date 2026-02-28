# Pine Script Warmup & Limit Calculation

## The Problem

Pine functions that look back over N bars (`ta.ema`, `ta.highest`, `ta.lowest`, `math.sum`, etc.) return `na` / `null` until they have enough bars to compute. If `limit` is too small, the entire output is N/A.

---

## Warmup Formula

```
warmup_bars = max_lookback_period + any_secondary_lookback
```

Examples:

```
// EMA golden cross
warmup = max(ema_slow_len=21) = 21 bars

// Extreme direction
warmup = period3(300) + countLookback(50) = 350 bars
```

Rule: `limit` must be at least `warmup + desired_output_bars`.

For a meaningful output of ~150 bars:
```
limit = warmup + 150
```

---

## Timeframe → Limit Reference

Warmup for `extreme_direction_5m.pine` (period3=96, lookback=24 → warmup=120, tuned for 4h trade window):

| Timeframe | Min limit (warmup only) | Limit for ~180 output bars | Real time covered |
|---|---|---|---|
| 1m  | 120 | 300 | ~5h |
| 3m  | 120 | 300 | ~15h |
| 5m  | 120 | 300 | ~25h |
| **15m** | 120 | **300** | **~75h** |
| 1h  | 120 | 300 | ~12 days |

**Selected timeframe: 15m** (see pine_timeframe_selection.md for rationale)

Warmup for `ema_golden_cross_15m.pine` (ema_slow=21 → warmup=21):

| Timeframe | Min limit | Limit for ~80 output bars | Real time covered |
|---|---|---|---|
| 15m | 21 | 100 | ~25h |
| 1h  | 21 | 100 | ~4 days |

---

## Diagnosing N/A Output

Symptom: all columns except `Close` show `N/A` from bar 0.

Check: count warmup bars in output — the index of the first non-null value.

```js
const trendData = plots["Trend"].data;
const firstValid = trendData.findIndex((d) => d.value !== null && !isNaN(d.value));
console.log("Warmup bars:", firstValid);
// if firstValid === trendData.length → limit too small, zero valid output
```

If `firstValid === trendData.length` → increase `limit` by at least `warmup - limit + desired_output`.

---

## Stacked Lookbacks

When multiple lookback functions are chained, warmup is additive:

```pine
h300 = ta.highest(high, 300)     // needs 300 bars
totalHighs = math.sum(isHigh, 50) // needs 50 more bars after h300 is valid
// total warmup = 300 + 50 = 350
```

`math.sum(x, n)` is NA until `x` itself is non-NA AND n bars have passed since then.

---

## Pine inputs cannot be set via run()

The `inputs` parameter in `run()` is silently ignored — Pine `input.int()` / `input.float()` defaults are always used.

To test different period values, change the defaults in the `.pine` file directly:

```pine
// change this line in the .pine file
period3 = input.int(300, "Period 3")  // → input.int(150, "Period 3")
```

This means warmup changes when tuning params — recalculate `limit` after any period change.
