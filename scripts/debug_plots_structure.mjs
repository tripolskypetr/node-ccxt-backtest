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

const plots = await run(
  File.fromPath("signal_strategy_15m.pine", "./math"),
  { symbol: "BTCUSDT", timeframe: "15m", limit: 100 },
  "ccxt-exchange",
  new Date("2024-02-08T00:00:00Z"),
);

console.log("Type of plots:", typeof plots);
console.log("Is array:", Array.isArray(plots));
console.log("Keys:", Object.keys(plots));

if (typeof plots === "object" && !Array.isArray(plots)) {
  const keys = Object.keys(plots);
  console.log("\nFirst key sample:", keys[0]);
  const first = plots[keys[0]];
  console.log("Value type:", typeof first, Array.isArray(first) ? "array" : "");
  if (Array.isArray(first)) {
    console.log("Length:", first.length);
    console.log("First item:", JSON.stringify(first[0]));
    console.log("Last item:", JSON.stringify(first[first.length - 1]));
  }
} else if (Array.isArray(plots)) {
  console.log("Array length:", plots.length);
  console.log("First item:", JSON.stringify(plots[0]).slice(0, 200));
}
