import { addExchangeSchema } from "backtest-kit";
import { singleshot } from "functools-kit";
import { run, File } from "@backtest-kit/pinets";
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

// Helper to extract value from plot data item
const val = (item) => (typeof item === "object" && item !== null ? item.value : item);
const time = (item) => (typeof item === "object" && item !== null ? item.time : null);

// Collect signal bars across Feb 2024 by running pine at multiple dates
const signalBars = [];
const seenTimestamps = new Set();

const runDates = [
  new Date("2024-02-08T00:00:00Z"),
  new Date("2024-02-15T00:00:00Z"),
  new Date("2024-02-22T00:00:00Z"),
  new Date("2024-02-29T23:59:59Z"),
];

for (const date of runDates) {
  console.log(`Running pine at ${date.toISOString().slice(0, 10)}...`);
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

// Sort by time
signalBars.sort((a, b) => a.timestamp - b.timestamp);
console.log(`\nFound ${signalBars.length} signal bars across Feb 2024\n`);

// Build candle map for fast lookup
const candleMap = new Map();
for (const c of allCandles) candleMap.set(c[0], c);

// Simulate DCA strategy for each signal
// Rules:
//   Entry: full size at close price
//   DCA trigger: price reaches -1% (low <= entry*0.99 for long)
//   After DCA: avg entry = entry*0.995 (two equal lots averaged)
//   TP target: entry * 1.02 (original entry price)
//   Hard SL: entry * 0.98 (original entry price)
//   Max window: 32 bars (8h)
//   Fees: 0.1% per leg, first entry = 0.2%, if DCA +0.2%, exit +0.2%

const results = [];

for (const sig of signalBars) {
  const entryPrice = sig.close;
  const isLong = sig.signal === 1;

  const tpPrice     = isLong ? entryPrice * 1.02  : entryPrice * 0.98;
  const dcaPrice    = isLong ? entryPrice * 0.99  : entryPrice * 1.01;
  const hardSlPrice = isLong ? entryPrice * 0.98  : entryPrice * 1.02;

  const entryIdx = allCandles.findIndex(c => c[0] === sig.timestamp);
  if (entryIdx === -1) {
    results.push({ ...sig, outcome: "not_found" });
    continue;
  }

  let dcaTriggered = false;
  let dcaBar = null;
  let outcome = "timeout";
  let exitBar = null;

  for (let j = entryIdx + 1; j <= entryIdx + 32 && j < allCandles.length; j++) {
    const [ts, open, high, low, close] = allCandles[j];

    if (isLong) {
      if (!dcaTriggered && low <= dcaPrice) {
        dcaTriggered = true;
        dcaBar = j - entryIdx;
      }
      if (low <= hardSlPrice) {
        outcome = "sl";
        exitBar = j - entryIdx;
        break;
      }
      if (high >= tpPrice) {
        outcome = "tp";
        exitBar = j - entryIdx;
        break;
      }
    } else {
      if (!dcaTriggered && high >= dcaPrice) {
        dcaTriggered = true;
        dcaBar = j - entryIdx;
      }
      if (high >= hardSlPrice) {
        outcome = "sl";
        exitBar = j - entryIdx;
        break;
      }
      if (low <= tpPrice) {
        outcome = "tp";
        exitBar = j - entryIdx;
        break;
      }
    }
  }

  results.push({
    timestamp: new Date(sig.timestamp).toISOString(),
    signal: isLong ? "LONG" : "SHORT",
    entryPrice,
    tpPrice,
    dcaPrice,
    hardSlPrice,
    dcaTriggered,
    dcaBar,
    outcome,
    exitBar,
  });
}

// Print table
console.log("=== DCA SIMULATION: Feb 2024 ===\n");
console.log(
  "Date".padEnd(20) +
  "Dir  ".padEnd(7) +
  "Entry ".padEnd(10) +
  "DCA?".padEnd(6) +
  "@bar".padEnd(6) +
  "Outcome  ".padEnd(10) +
  "Exit@bar"
);
console.log("-".repeat(65));
for (const r of results) {
  if (r.outcome === "not_found") continue;
  console.log(
    r.timestamp.slice(0, 19).replace("T", " ").padEnd(20) +
    r.signal.padEnd(7) +
    r.entryPrice.toFixed(0).padEnd(10) +
    (r.dcaTriggered ? "YES" : "no ").padEnd(6) +
    (r.dcaBar !== null ? String(r.dcaBar) : "-").padEnd(6) +
    r.outcome.padEnd(10) +
    (r.exitBar !== null ? String(r.exitBar) : "32+")
  );
}

// EV calculation
function analyze(group, label) {
  if (!group.length) { console.log(`\n${label}: no data`); return; }

  const tp = group.filter(r => r.outcome === "tp");
  const sl = group.filter(r => r.outcome === "sl");
  const to = group.filter(r => r.outcome === "timeout");
  const dcaAll = group.filter(r => r.dcaTriggered);
  const dcaTp = dcaAll.filter(r => r.outcome === "tp");
  const dcaSl = dcaAll.filter(r => r.outcome === "sl");
  const dcaTo = dcaAll.filter(r => r.outcome === "timeout");

  const n = group.length;

  console.log(`\n─── ${label} (n=${n}) ───`);
  console.log(`  TP:      ${tp.length}/${n} = ${(tp.length/n*100).toFixed(0)}%`);
  console.log(`  SL:      ${sl.length}/${n} = ${(sl.length/n*100).toFixed(0)}%`);
  console.log(`  Timeout: ${to.length}/${n} = ${(to.length/n*100).toFixed(0)}%`);
  console.log(`  DCA triggered: ${dcaAll.length}/${n} = ${(dcaAll.length/n*100).toFixed(0)}%`);
  console.log(`    → TP after DCA:      ${dcaTp.length}`);
  console.log(`    → SL after DCA:      ${dcaSl.length}`);
  console.log(`    → Timeout after DCA: ${dcaTo.length}`);

  // EV simple (single entry, no DCA)
  // TP: +2% net, SL: -1% net, timeout: 0% (exit flat) — all minus fees 0.4%
  const fees = 0.004;
  const ev_simple =
    (tp.length * (0.02 - fees) +
     sl.length * (-0.01 - fees) +
     to.length * (-fees)) / n;

  // EV with DCA
  // No-DCA group: same as simple
  // DCA group: avg entry = entry*0.995
  //   TP from avg: (1.02/0.995 - 1) = 2.51% gross, fees = 0.006 (entry1 + entry2 + exit)
  //   SL from avg: (0.995/0.98 - 1 but inverted) = -1.51% gross, fees = 0.006
  //   Timeout from avg: 0% gross, fees = 0.006
  const noDca = group.filter(r => !r.dcaTriggered);
  const ev_dca = (
    noDca.filter(r => r.outcome === "tp").length * (0.02 - fees) +
    noDca.filter(r => r.outcome === "sl").length * (-0.01 - fees) +
    noDca.filter(r => r.outcome === "timeout").length * (-fees) +
    dcaTp.length * (0.0251 - 0.006) +
    dcaSl.length * (-0.0151 - 0.006) +
    dcaTo.length * (0 - 0.006)
  ) / n;

  // Also compute: if we ONLY do DCA (never enter without DCA condition met)
  // = only trade when DCA is eventually triggered
  // This is hypothetical — we still enter on signal, DCA is automatic

  console.log(`\n  EV (no DCA strategy):  ${(ev_simple * 100).toFixed(3)}% per trade`);
  console.log(`  EV (with DCA +1%):     ${(ev_dca * 100).toFixed(3)}% per trade`);
  console.log(`  Delta:                 ${((ev_dca - ev_simple) * 100).toFixed(3)}%`);
}

const valid = results.filter(r => r.outcome !== "not_found");
analyze(valid.filter(r => r.signal === "LONG"), "LONG");
analyze(valid.filter(r => r.signal === "SHORT"), "SHORT");
analyze(valid, "ALL");

console.log("\n═══════════════════════════════════════");
console.log("Note: DCA doubles position size — EV above is per-unit");
console.log("Capital-weighted: DCA trades cost 2x, so scale EV_dca by ~0.5 for fair comparison");
const valid2 = valid;
const dcaCount = valid2.filter(r => r.dcaTriggered).length;
const noDcaCount = valid2.length - dcaCount;
const avgCapital = (noDcaCount * 1 + dcaCount * 2) / valid2.length;
console.log(`Avg capital deployed per trade: ${avgCapital.toFixed(2)}x`);
