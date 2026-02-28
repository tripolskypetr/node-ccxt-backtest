# Pine Script Debugging Guide

## Context

This project runs Pine Script indicators via `@backtest-kit/pinets` against real exchange data fetched through `ccxt`. The Pine interpreter executes `.pine` files and returns named plot series. The JS runner reads those series by name via a schema object.

Key files:
- `math/*.pine` — Pine Script indicators
- `scripts/run_*.mjs` — JS runner scripts
- Interpreter entry: `run(File.fromPath(...), { symbol, timeframe, limit }, exchangeName, sinceDate)`

---

## How Plots Are Exposed to JS

Pine plots marked `display=display.data_window` are accessible by name in the returned `plots` object.

```pine
plot(close, "Close", display=display.data_window)
plot(active_signal, "Signal", display=display.data_window)
```

The JS schema maps JS field names → Pine plot names:

```js
const SIGNAL_SCHEMA = {
  position: "Signal",   // JS key → Pine plot name
  priceOpen: "Close",
};
```

`toMarkdown(signalId, plots, schema)` renders a markdown table with columns matching schema keys + `timestamp`.

---

## Debug Workflow

### Step 1 — Add debug plots to Pine

Add extra `display=display.data_window` plots for internal variables you want to inspect:

```pine
// === OUTPUTS FOR BOT ===
plot(close, "Close", display=display.data_window)
plot(active_signal, "Signal", display=display.data_window)

// === DEBUG ===
plot(ema_fast, "EmaFast", display=display.data_window)
plot(ema_slow, "EmaSlow", display=display.data_window)
plot(ema_fast - ema_slow, "EmaGap", display=display.data_window)
plot(bars_since_signal, "BarsSinceSignal", display=display.data_window)
plot(last_signal, "LastSignal", display=display.data_window)
```

### Step 2 — Extend the JS schema

Add corresponding entries to `SIGNAL_SCHEMA` in the runner script:

```js
const SIGNAL_SCHEMA = {
  position: "Signal",
  priceOpen: "Close",
  emaFast: "EmaFast",
  emaSlow: "EmaSlow",
  emaGap: "EmaGap",
  barsSinceSignal: "BarsSinceSignal",
  lastSignal: "LastSignal",
};
```

### Step 3 — Run and read the table

```bash
node ./scripts/run_*.mjs
```

Output is a markdown table. Read column values row by row to trace signal logic.

---

## Common Patterns

### N/A values
EMA of length N returns `N/A` for the first `N-1` bars — this is expected warmup behavior. `EmaFast` (len=8) starts at bar 8, `EmaSlow` (len=21) starts at bar 21.

### Diagnosing whipsaw
Look at `EmaGap` at the moment `last_signal` changes (i.e. `barsSinceSignal == 0`). If `|EmaGap|` is small (e.g. < 15), the crossover happened in a flat/noisy zone — likely a false signal.

### Diagnosing stale signals
`active_signal` goes to 0 when `bars_since_signal > signal_valid_bars`. If `position` is 0 but `lastSignal` is non-zero, the signal expired. Increase `signal_valid_bars` or check why the crossover didn't sustain.

---

## Adding Filters

Filters go into the entry condition expressions:

```pine
min_gap = input.float(15.0, "Min EMA Gap Filter", minval=0.0)

long_cond  = ta.crossover(ema_fast, ema_slow)  and math.abs(ema_gap) >= min_gap
short_cond = ta.crossunder(ema_fast, ema_slow) and math.abs(ema_gap) >= min_gap
```

Expose the filter threshold and intermediate values as debug plots to verify filter behavior:

```pine
plot(ema_gap, "EmaGap", display=display.data_window)
```

Then check: when `barsSinceSignal` resets to 0, does `EmaGap` meet the threshold?

---

## Runner Script Boilerplate

Full copy of a working `scripts/run_*.mjs` file. Reproduce this when creating a new runner for a new `.pine` file.

```js
import { addExchangeSchema } from "backtest-kit";
import { singleshot, randomString } from "functools-kit";
import { run, File, toMarkdown } from "@backtest-kit/pinets";
import ccxt from "ccxt";

const SIGNAL_SCHEMA = {
  position: "Signal",
  priceOpen: "Close",
  // add debug fields here matching Pine plot names
  emaFast: "EmaFast",
  emaSlow: "EmaSlow",
  emaGap: "EmaGap",
  barsSinceSignal: "BarsSinceSignal",
  lastSignal: "LastSignal",
};

const SIGNAL_ID = randomString();

const getExchange = singleshot(async () => {
  const exchange = new ccxt.binance({
    options: {
      defaultType: "spot",
      adjustForTimeDifference: true,
      recvWindow: 60000,
    },
    enableRateLimit: true,
  });
  await exchange.loadMarkets();
  return exchange;
});

addExchangeSchema({
  exchangeName: "ccxt-exchange",
  getCandles: async (symbol, interval, since, limit) => {
    const exchange = await getExchange();
    const candles = await exchange.fetchOHLCV(
      symbol,
      interval,
      since.getTime(),
      limit,
    );
    return candles.map(([timestamp, open, high, low, close, volume]) => ({
      timestamp,
      open,
      high,
      low,
      close,
      volume,
    }));
  },
});

const plots = await run(
  File.fromPath("my_indicator.pine", "./math"),  // <-- pine file name
  {
    symbol: "BTCUSDT",   // <-- symbol in exchange format
    timeframe: "15m",    // <-- ccxt interval string
    limit: 100,          // <-- number of candles
  },
  "ccxt-exchange",
  new Date("2025-09-23T16:00:00.000Z"),  // <-- end date (sinceDate = endDate - limit * interval)
);

console.log(await toMarkdown(SIGNAL_ID, plots, SIGNAL_SCHEMA));
```

Notes:
- `File.fromPath(filename, dir)` — `filename` is relative to `dir`, not cwd
- `sinceDate` is the **end** of the requested range; the interpreter fetches `limit` candles backward from it
- `exchangeName` is required here because `scripts/run_*.mjs` runs standalone via `node` — there is no CLI context to inject it automatically. In `content/*.strategy.ts` files run by the backtest-kit CLI, the exchange is resolved from context and `exchangeName` should be omitted from `run()`
- `SIGNAL_SCHEMA` keys become markdown table column headers; values are Pine plot names (case-sensitive)

---

## Pine Variables Worth Plotting for Debug

| Variable | Purpose |
|---|---|
| `ema_fast - ema_slow` | Gap magnitude — key for noise filtering |
| `bars_since_signal` | How many bars since last crossover |
| `last_signal` | Raw last direction (1/-1/0), ignores expiry |
| `active_signal` | Final output after expiry window |
| `ta.rsi(close, 14)` | Momentum context |
| `ta.atr(14)` | Volatility context for dynamic thresholds |
| `volume` | Volume spike confirmation |
