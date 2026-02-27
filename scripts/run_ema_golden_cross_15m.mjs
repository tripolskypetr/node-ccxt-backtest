import { addExchangeSchema } from "backtest-kit";
import { singleshot, randomString } from "functools-kit";
import { run, File, toMarkdown } from "@backtest-kit/pinets";
import ccxt from "ccxt";

const SIGNAL_SCHEMA = {
  position: "Signal",
  priceOpen: "Close",
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
  File.fromPath("ema_golden_cross_15m.pine", "./math"),
  {
    symbol: "BTCUSDT",
    timeframe: "15m",
    limit: 100,
  },
  "ccxt-exchange",
  new Date("2025-09-23T16:00:00.000Z"),
);

console.log(await toMarkdown(SIGNAL_ID, plots, SIGNAL_SCHEMA));
