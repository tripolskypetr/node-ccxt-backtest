# Strategy Nodes: Connecting Pine Indicators to a Strategy

## Architecture

A strategy file (`content/*.strategy.ts`) wires Pine indicators into a signal graph using three primitives from `@backtest-kit/graph`:

```
sourceNode  →  outputNode  →  addStrategySchema.getSignal → resolve
```

Each `sourceNode` wraps one Pine indicator. `outputNode` combines multiple sources and produces a trade signal or `null`. `resolve` evaluates the graph on each strategy tick.

---

## sourceNode + Cache.fn

`sourceNode` wraps a cached async function that fetches and extracts Pine plot data.

```ts
const directionTimeframe = sourceNode(
  Cache.fn(
    async (symbol) => {
      const plots = await run(
        File.fromPath("extreme_direction_5m.pine", "../math"),
        { symbol, timeframe: "5m", limit: 600 },
      );
      return extract(plots, {
        trend: "Trend",  // JS field ← Pine plot name
      });
    },
    { interval: "5m", key: ([symbol]) => symbol },
  ),
);
```

### Cache.fn parameters

| Parameter | Purpose |
|---|---|
| `interval` | How often the cache invalidates and re-fetches. **Must match `timeframe` in `run()`** |
| `key` | Cache key function. Use `([symbol]) => symbol` for per-symbol caching |

If `interval` and `timeframe` don't match, the cache either re-fetches too often (wasted API calls) or serves stale data (wrong signal on the current bar).

### extract()

`extract(plots, schema)` is the strategy equivalent of `SIGNAL_SCHEMA` in debug scripts. Returns a plain object with the **current bar's** values:

```ts
// debug script — returns full table
toMarkdown(id, plots, { position: "Signal", priceOpen: "Close" })

// strategy node — returns single current-bar object
extract(plots, { position: "Signal", priceOpen: "Close" })
// → { position: 1, priceOpen: 112881.32 }
```

`extract` always returns the last value in each plot series — the value at the most recent bar of the fetched window.

### File path in strategy files

Pine files are in `math/`, strategy files are in `content/`. Path is relative to the `.pine` file directory argument:

```ts
File.fromPath("extreme_direction_5m.pine", "../math")
//                                           ↑ relative to content/, goes up one level
```

In standalone `scripts/run_*.mjs` the path is `"./math"` because scripts run from the project root.

### exchangeName in run()

**Omit `exchangeName` in strategy files.** The backtest-kit CLI injects the exchange from context automatically. Passing it explicitly is not wrong but redundant.

In standalone `scripts/run_*.mjs`, `exchangeName` **is required** — there is no CLI context.

---

## outputNode

`outputNode` takes a combiner function and any number of source nodes as additional arguments. The combiner receives an array of the resolved source values in the same order.

```ts
const strategySignal = outputNode(
  async ([direction, goldenCross]) => {
    // direction  = { trend: 1 | -1 | 0 }
    // goldenCross = { position: 1 | -1 | 0, priceOpen: number }

    if (goldenCross.position === 0) return null;          // no signal — skip
    if (direction.trend === -1 && goldenCross.position === 1) return null;  // trend disagrees
    if (direction.trend === 1  && goldenCross.position === -1) return null; // trend disagrees

    const isLong = goldenCross.position === 1;
    return {
      id: randomString(),
      position: isLong ? "long" : "short",
      priceTakeProfit: isLong ? goldenCross.priceOpen * 1.01 : goldenCross.priceOpen * 0.99,
      priceStopLoss:   isLong ? goldenCross.priceOpen * 0.99 : goldenCross.priceOpen * 1.01,
      minuteEstimatedTime: 240,
    } as const;
  },
  directionTimeframe,   // → direction
  goldenCrossTimeframe, // → goldenCross
);
```

Return `null` to skip the current tick. Return a signal object to open a position.

### Signal object fields

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique signal ID — use `randomString()` |
| `position` | `"long" \| "short"` | Trade direction |
| `priceTakeProfit` | `number` | TP price level |
| `priceStopLoss` | `number` | SL price level |
| `minuteEstimatedTime` | `number` | Expected trade duration in minutes |

---

## Multi-indicator Filter Logic Pattern

The pattern used here: **fast indicator gates slow indicator**.

```
extreme_direction_5m  →  trend context (slow, reliable)
ema_golden_cross_15m  →  entry signal (fast, noisy)

outputNode logic:
  if no entry signal → null
  if entry direction contradicts trend → null
  else → open position in entry signal direction
```

This prevents taking long signals during a bear trend and short signals during a bull trend. The direction indicator acts as a regime filter.

Rules for combining indicators this way:
- The **context indicator** (trend/regime) should use a slower or equal timeframe vs the entry indicator
- `trend === 0` (neutral/warmup) is treated as permissive — both long and short are allowed when trend is undecided. Add an explicit check if you want to block on neutral:
  ```ts
  if (direction.trend === 0) return null;
  ```

---

## addStrategySchema

```ts
addStrategySchema({
  strategyName: "trailing_stop_strategy",
  interval: "15m",           // tick rate — how often getSignal is called
  getSignal: () => resolve(strategySignal),
});
```

`interval` here is the strategy tick rate, independent of indicator timeframes. Set it to the timeframe of the fastest entry signal indicator (`goldenCrossTimeframe` runs on `15m`, so `interval: "15m"`).

## addFrameSchema

```ts
addFrameSchema({
  frameName: "feb_2024_frame",
  interval: "1m",                              // candle granularity for the backtest frame
  startDate: new Date("2024-02-01T00:00:00Z"),
  endDate:   new Date("2024-02-29T23:59:59Z"),
  note: "Bull run period",
});
```

`interval` here is the candle resolution of the backtest replay, not the strategy tick rate.

---

## Full Boilerplate

```ts
import { extract, run, File } from "@backtest-kit/pinets";
import { addExchangeSchema, addFrameSchema, addStrategySchema, Cache } from "backtest-kit";
import { randomString, singleshot } from "functools-kit";
import { sourceNode, outputNode, resolve } from "@backtest-kit/graph";
import ccxt from "ccxt";

const getExchange = singleshot(async () => {
  const exchange = new ccxt.binance({
    options: { defaultType: "spot", adjustForTimeDifference: true, recvWindow: 60000 },
    enableRateLimit: true,
  });
  await exchange.loadMarkets();
  return exchange;
});

addExchangeSchema({
  exchangeName: "ccxt-exchange",
  getCandles: async (symbol, interval, since, limit) => {
    const exchange = await getExchange();
    const candles = await exchange.fetchOHLCV(symbol, interval, since.getTime(), limit);
    return candles.map(([timestamp, open, high, low, close, volume]) => ({
      timestamp: <number>timestamp,
      open: <number>open,
      high: <number>high,
      low: <number>low,
      close: <number>close,
      volume: <number>volume,
    }));
  },
});

// --- SOURCE NODES ---

const myContextNode = sourceNode(
  Cache.fn(
    async (symbol) => {
      const plots = await run(
        File.fromPath("my_context.pine", "../math"),
        { symbol, timeframe: "5m", limit: 600 },  // timeframe must match interval below
      );
      return extract(plots, { trend: "Trend" });
    },
    { interval: "5m", key: ([symbol]) => symbol },  // interval must match timeframe above
  ),
);

const myEntryNode = sourceNode(
  Cache.fn(
    async (symbol) => {
      const plots = await run(
        File.fromPath("my_entry.pine", "../math"),
        { symbol, timeframe: "15m", limit: 100 },
      );
      return extract(plots, { position: "Signal", priceOpen: "Close" });
    },
    { interval: "15m", key: ([symbol]) => symbol },
  ),
);

// --- OUTPUT NODE ---

const strategySignal = outputNode(
  async ([context, entry]) => {
    if (entry.position === 0) return null;
    if (context.trend === -1 && entry.position === 1) return null;
    if (context.trend === 1  && entry.position === -1) return null;

    const isLong = entry.position === 1;
    return {
      id: randomString(),
      position: isLong ? "long" : "short",
      priceTakeProfit: isLong ? entry.priceOpen * 1.01 : entry.priceOpen * 0.99,
      priceStopLoss:   isLong ? entry.priceOpen * 0.99 : entry.priceOpen * 1.01,
      minuteEstimatedTime: 240,
    } as const;
  },
  myContextNode,
  myEntryNode,
);

// --- REGISTRATION ---

addFrameSchema({
  frameName: "my_frame",
  interval: "1m",
  startDate: new Date("2024-02-01T00:00:00Z"),
  endDate:   new Date("2024-02-29T23:59:59Z"),
  note: "",
});

addStrategySchema({
  strategyName: "my_strategy",
  interval: "15m",  // tick rate = fastest entry indicator timeframe
  getSignal: () => resolve(strategySignal),
});
```
