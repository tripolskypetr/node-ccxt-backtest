import {
  addOutline,
  dumpOutlineResult,
  IOutlineHistory,
  IOutlineResult,
} from "agent-swarm-kit";
import { str } from "functools-kit";
import { OutlineName } from "../../enum/OutlineName";
import { CompletionName } from "../../enum/CompletionName";
import { ReversalResponseContract } from "../../contract/ReversalResponse.contract";
import { HourlyResearchResponseContract } from "../../contract/HourlyResearchResponse.contract";
import { formatPrice, formatQuantity, getCandles } from "backtest-kit";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc);

const CANDLES_LIMIT = 12; // 12 x 15m = 3 часа — достаточно для проверки разворота

const REVERSAL_PROMPT = str.newline(
  "Ты — трейдер. Ты в открытой позиции. Ранее был сформулирован критерий разворота.",
  "Твоя задача — проверить по текущим свечам: критерий разворота сработал?",
  "",
  "**Как проверять:**",
  " - Читай критерий разворота буквально. Это конкретное условие — либо сработало, либо нет.",
  " - Смотри на последние свечи: пробои уровней, объём против позиции, резкие движения.",
  " - Не интерпретируй широко. Сомнение — это HOLD, не EXIT.",
  " - Не учитывай собственные соображения о рынке — только критерий против свечей.",
  "",
  "**Определения:**",
  " - **EXIT**: критерий разворота сработал — позицию нужно закрыть немедленно.",
  " - **HOLD**: критерий не сработал — позицию держать.",
  "",
  "**Требуемый результат:**",
  "1. **action**: EXIT или HOLD.",
  "2. **reasoning**: какие именно данные из свечей подтверждают или опровергают срабатывание критерия разворота.",
);

const commitCandles = async (symbol: string, history: IOutlineHistory) => {
  const candles = await getCandles(symbol, "15m", CANDLES_LIMIT);

  let markdown = `## 15-Minute Candles (Last ${CANDLES_LIMIT})\n`;
  markdown += `> Symbol: ${symbol.toUpperCase()}\n\n`;
  markdown += `| # | Time | Open | High | Low | Close | Volume | Change % | Volatility % | Body % |\n`;
  markdown += `|---|------|------|------|-----|-------|--------|----------|--------------|--------|\n`;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const volatility = ((c.high - c.low) / c.close) * 100;
    const bodySize = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    const bodyPct = range > 0 ? (bodySize / range) * 100 : 0;
    const changePct = c.open > 0 ? ((c.close - c.open) / c.open) * 100 : 0;
    const time = dayjs.utc(c.timestamp).format("YYYY-MM-DD HH:mm") + " UTC";

    const open = await formatPrice(symbol, c.open);
    const high = await formatPrice(symbol, c.high);
    const low = await formatPrice(symbol, c.low);
    const close = await formatPrice(symbol, c.close);
    const volume = formatQuantity(symbol, c.volume);

    markdown += `| ${i + 1} | ${time} | ${open} | ${high} | ${low} | ${close} | ${volume} | ${changePct.toFixed(3)}% | ${volatility.toFixed(2)}% | ${bodyPct.toFixed(1)}% |\n`;
  }

  await history.push(
    { role: "user", content: str.newline("Прочитай текущие 15-минутные свечи и скажи ОК", "", markdown) },
    { role: "assistant", content: "ОК" },
  );
};

const commitResearch = async (
  research: HourlyResearchResponseContract,
  history: IOutlineHistory,
) => {
  await history.push(
    {
      role: "user",
      content: str.newline(
        "Прочитай исходный сигнал и критерий разворота, скажи ОК",
        "",
        `**Сигнал:** ${research.signal}`,
        `**Обоснование:** ${research.reasoning}`,
        `**Критерий разворота:** ${research.reversalSignal}`,
      ),
    },
    { role: "assistant", content: "ОК" },
  );
};

addOutline<ReversalResponseContract>({
  outlineName: OutlineName.ReversalOutline,
  completion: CompletionName.OllamaOutlineToolCompletion,
  format: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "Решение о позиции: EXIT — критерий разворота сработал, HOLD — держать.",
        enum: ["HOLD", "EXIT"],
      },
      reasoning: {
        type: "string",
        description: "Какие данные из свечей подтверждают или опровергают срабатывание критерия разворота.",
      },
    },
    required: ["action", "reasoning"],
  },
  getOutlineHistory: async (
    { history },
    research: HourlyResearchResponseContract,
    symbol: string,
    when: Date,
  ) => {
    await history.push({
      role: "system",
      content: str.newline(
        `Текущая дата и время: ${dayjs.utc(when).format("DD MMMM YYYY HH:mm")} UTC`,
        `Актив: ${symbol.toUpperCase()}`,
      ),
    });
    await commitResearch(research, history);
    await commitCandles(symbol, history);
    await history.push({ role: "user", content: REVERSAL_PROMPT });
  },
  validations: [
    {
      validate: ({ data }) => {
        if (!data.action) throw new Error("Поле action не заполнено");
      },
      docDescription: "Проверяет, что action определён.",
    },
    {
      validate: ({ data }) => {
        if (!["HOLD", "EXIT"].includes(data.action)) {
          throw new Error("Поле action должно быть HOLD или EXIT");
        }
      },
      docDescription: "Проверяет, что action содержит допустимое значение.",
    },
    {
      validate: ({ data }) => {
        if (!data.reasoning) throw new Error("Поле reasoning не заполнено");
      },
      docDescription: "Проверяет, что решение обосновано.",
    },
  ],
  callbacks: {
    async onValidDocument(result: IOutlineResult<ReversalResponseContract>) {
      if (!result.data) return;
      if (result.data.action === "HOLD") return;
      await dumpOutlineResult(result, "./dump/outline/reversal");
    },
  },
});
