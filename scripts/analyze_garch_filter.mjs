import { addExchangeSchema } from "backtest-kit";
import { singleshot } from "functools-kit";
import { run, File } from "@backtest-kit/pinets";
import { predictRange } from "garch";
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
      timestamp, open, high, low, close, volume,
    }));
  },
});

const exchange = await getExchange();

// Fetch all 15m candles for Feb 2024
console.log("Fetching Feb 2024 15m candles...");
const allCandles = [];
let since = new Date("2024-02-01T00:00:00Z").getTime();
const end = new Date("2024-02-29T23:59:59Z").getTime();

while (since < end) {
  const batch = await exchange.fetchOHLCV("BTCUSDT", "15m", since, 500);
  if (batch.length === 0) break;
  for (const c of batch) {
    if (c[0] <= end) allCandles.push(c);
  }
  since = batch[batch.length - 1][0] + 15 * 60 * 1000;
  if (batch.length < 500) break;
}
console.log(`Total 15m candles: ${allCandles.length}`);

// Fetch extra history before Feb for GARCH warmup (1000 candles = ~10 days before)
console.log("Fetching pre-Feb candles for GARCH warmup...");
const warmupSince = new Date("2024-01-01T00:00:00Z").getTime();
const preFebCandles = [];
let wSince = warmupSince;
while (wSince < new Date("2024-02-01T00:00:00Z").getTime()) {
  const batch = await exchange.fetchOHLCV("BTCUSDT", "15m", wSince, 500);
  if (batch.length === 0) break;
  for (const c of batch) {
    if (c[0] < new Date("2024-02-01T00:00:00Z").getTime()) preFebCandles.push(c);
  }
  wSince = batch[batch.length - 1][0] + 15 * 60 * 1000;
  if (batch.length < 500) break;
}
console.log(`Pre-Feb candles: ${preFebCandles.length}`);

const val = (item) => (typeof item === "object" && item !== null ? item.value : item);
const time = (item) => (typeof item === "object" && item !== null ? item.time : null);

// Collect signal bars
const signalBars = [];
const seenTimestamps = new Set();

const runDates = [
  new Date("2024-02-08T00:00:00Z"),
  new Date("2024-02-15T00:00:00Z"),
  new Date("2024-02-22T00:00:00Z"),
  new Date("2024-02-29T23:59:59Z"),
];

for (const date of runDates) {
  const plots = await run(
    File.fromPath("signal_strategy_15m.pine", "./math"),
    { symbol: "BTCUSDT", timeframe: "15m", limit: 100 },
    "ccxt-exchange",
    date,
  );
  const barsSinceData = plots["d_BarsSince"].data;
  const signalData = plots["Signal"].data;
  const closeData = plots["Close"].data;
  const slData = plots["StopLoss"].data;
  const tpData = plots["TakeProfit"].data;

  for (let i = 0; i < barsSinceData.length; i++) {
    const bs = val(barsSinceData[i]);
    const sig = val(signalData[i]);
    const ts = time(barsSinceData[i]);
    if (bs === 0 && sig !== 0 && sig !== null && ts !== null && !seenTimestamps.has(ts)) {
      seenTimestamps.add(ts);
      signalBars.push({
        timestamp: ts,
        signal: sig,
        close: val(closeData[i]),
        sl: val(slData[i]),
        tp: val(tpData[i]),
      });
    }
  }
}
signalBars.sort((a, b) => a.timestamp - b.timestamp);
console.log(`\nFound ${signalBars.length} signal bars\n`);

// For each signal bar: compute GARCH movePercent at that moment
// Use all candles up to (but not including) the signal bar
const combinedCandles = [...preFebCandles, ...allCandles];

function toCandleObj(raw) {
  return { timestamp: raw[0], open: raw[1], high: raw[2], low: raw[3], close: raw[4], volume: raw[5] };
}

// Simulate outcomes (same logic as analyze_dca_feb2024)
function simulateOutcome(entryIdx, isLong) {
  const entryPrice = allCandles[entryIdx][4]; // close
  const tpPrice     = isLong ? entryPrice * 1.02 : entryPrice * 0.98;
  const hardSlPrice = isLong ? entryPrice * 0.98 : entryPrice * 1.02;

  for (let j = entryIdx + 1; j <= entryIdx + 32 && j < allCandles.length; j++) {
    const [, , high, low] = allCandles[j];
    if (isLong) {
      if (low <= hardSlPrice) return "sl";
      if (high >= tpPrice) return "tp";
    } else {
      if (high >= hardSlPrice) return "sl";
      if (low <= tpPrice) return "tp";
    }
  }
  return "timeout";
}

console.log("=== GARCH FILTER ANALYSIS ===\n");
console.log(
  "Date".padEnd(20) +
  "Dir  ".padEnd(7) +
  "Entry ".padEnd(10) +
  "movePercent".padEnd(13) +
  "reliable".padEnd(10) +
  "GARCH pass?".padEnd(13) +
  "Outcome"
);
console.log("-".repeat(80));

const results = [];

for (const sig of signalBars) {
  const entryIdx = allCandles.findIndex(c => c[0] === sig.timestamp);
  if (entryIdx === -1) continue;

  const isLong = sig.signal === 1;
  const outcome = simulateOutcome(entryIdx, isLong);

  // Build candle history up to (not including) this bar
  const combinedIdx = combinedCandles.findIndex(c => c[0] === sig.timestamp);
  const historyRaw = combinedIdx >= 1000
    ? combinedCandles.slice(combinedIdx - 1000, combinedIdx)
    : combinedCandles.slice(0, combinedIdx);

  const history = historyRaw.map(toCandleObj);

  let movePercent = null;
  let reliable = false;
  let garchPass = false;

  try {
    const pred = predictRange(history, "15m", 32);
    movePercent = pred.movePercent;
    reliable = pred.reliable;
    garchPass = pred.movePercent >= 1.0;
  } catch (e) {
    movePercent = null;
  }

  results.push({ sig, outcome, movePercent, reliable, garchPass, isLong });

  const passStr = movePercent === null ? "ERROR" : garchPass ? "YES" : "no";
  console.log(
    new Date(sig.timestamp).toISOString().slice(0, 19).replace("T", " ").padEnd(20) +
    (isLong ? "LONG" : "SHORT").padEnd(7) +
    sig.close.toFixed(0).padEnd(10) +
    (movePercent !== null ? movePercent.toFixed(3) + "%" : "N/A").padEnd(13) +
    (reliable ? "yes" : "no").padEnd(10) +
    passStr.padEnd(13) +
    outcome
  );
}

// Summary
console.log("\n=== SUMMARY ===\n");

const valid = results.filter(r => r.movePercent !== null);
const filtered = valid.filter(r => !r.garchPass);
const passed = valid.filter(r => r.garchPass);

console.log(`Total signals: ${valid.length}`);
console.log(`GARCH blocked (movePercent < 1%): ${filtered.length}`);
console.log(`GARCH passed  (movePercent >= 1%): ${passed.length}`);

console.log("\nBlocked signals outcomes (what we avoided):");
for (const r of filtered) {
  console.log(`  ${new Date(r.sig.timestamp).toISOString().slice(0,10)} ${r.isLong?"LONG":"SHORT"} movePercent=${r.movePercent.toFixed(3)}% → ${r.outcome}`);
}

console.log("\nPassed signals outcomes:");
for (const r of passed) {
  console.log(`  ${new Date(r.sig.timestamp).toISOString().slice(0,10)} ${r.isLong?"LONG":"SHORT"} movePercent=${r.movePercent.toFixed(3)}% → ${r.outcome}`);
}

// EV comparison
const fees = 0.004;
function ev(group) {
  if (!group.length) return 0;
  const tp = group.filter(r => r.outcome === "tp").length;
  const sl = group.filter(r => r.outcome === "sl").length;
  const to = group.filter(r => r.outcome === "timeout").length;
  const n = group.length;
  return (tp * (0.02 - fees) + sl * (-0.01 - fees) + to * (-fees)) / n;
}

console.log(`\nEV all signals:      ${(ev(valid) * 100).toFixed(3)}% per trade (n=${valid.length})`);
console.log(`EV GARCH-passed:     ${(ev(passed) * 100).toFixed(3)}% per trade (n=${passed.length})`);
console.log(`EV GARCH-blocked:    ${(ev(filtered) * 100).toFixed(3)}% per trade (n=${filtered.length}) ← avoided`);
