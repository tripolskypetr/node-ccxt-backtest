import {
  Storage,
  Notification,
  Markdown,
  Report,
  StorageLive,
  StorageBacktest,
  NotificationLive,
  NotificationBacktest,
  Backtest,
} from "backtest-kit";

import * as ui from "@backtest-kit/ui";

import "./src/index.mjs";

{
  Storage.enable();
  Notification.enable();
}

{
  Markdown.disable();
  Report.enable();
}

{
  StorageLive.usePersist();
  StorageBacktest.usePersist();
}

{
  NotificationLive.usePersist();
  NotificationBacktest.usePersist();
}

Backtest.background("BTCUSDT", {
  exchangeName: "binance_exchange",
  strategyName: "main_strategy",
  frameName: "backtest_frame",
});

ui.serve();
