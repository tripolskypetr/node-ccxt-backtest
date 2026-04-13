import {
  addOutline,
  dumpOutlineResult,
  IOutlineHistory,
  IOutlineResult,
} from "agent-swarm-kit";
import { str } from "functools-kit";
import { OutlineName } from "../../enum/OutlineName";
import { CompletionName } from "../../enum/CompletionName";
import { EntryResponseContract } from "../../contract/EntryResponse.contract";
import { HourlyResearchResponseContract } from "../../contract/HourlyResearchResponse.contract";
import { formatPrice, formatQuantity, getCandles } from "backtest-kit";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc);

const CANDLES_LIMIT = 12; // 12 x 15m = 3 часа — достаточно для проверки входа

const ENTRY_PROMPT = str.newline(
  "Ты — трейдер. Ранее был выдан сигнал и сформулирован критерий входа.",
  "Твоя задача — проверить по текущим свечам: критерий входа выполняется прямо сейчас?",
  "",
  "**Как проверять:**",
  " - Читай критерий входа буквально. Это конкретное условие — либо выполняется, либо нет.",
  " - Смотри на последние свечи: цена, объём, направление движения.",
  " - Не интерпретируй широко. Если условие неоднозначно — это WAIT.",
  " - Не учитывай собственные соображения о рынке — только критерий против свечей.",
  "",
  "**Определения:**",
  " - **ENTER**: критерий входа выполняется на последних свечах — можно открывать позицию.",
  " - **WAIT**: критерий не выполняется или выполняется частично — ждать.",
  "",
  "**Требуемый результат:**",
  "1. **action**: ENTER или WAIT.",
  "2. **reasoning**: какие именно данные из свечей подтверждают или опровергают критерий входа.",
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
        "Прочитай исходный сигнал и критерий входа, скажи ОК",
        "",
        `**Сигнал:** ${research.signal}`,
        `**Обоснование:** ${research.reasoning}`,
        `**Критерий входа:** ${research.entryConfirmation}`,
      ),
    },
    { role: "assistant", content: "ОК" },
  );
};

addOutline<EntryResponseContract>({
  outlineName: OutlineName.EntryOutline,
  completion: CompletionName.OllamaOutlineToolCompletion,
  format: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "Решение о входе: ENTER — критерий выполняется, WAIT — не выполняется.",
        enum: ["ENTER", "WAIT"],
      },
      reasoning: {
        type: "string",
        description: "Какие данные из свечей подтверждают или опровергают критерий входа.",
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
    await history.push({ role: "user", content: ENTRY_PROMPT });
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
        if (!["ENTER", "WAIT"].includes(data.action)) {
          throw new Error("Поле action должно быть ENTER или WAIT");
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
    async onValidDocument(result: IOutlineResult<EntryResponseContract>) {
      if (!result.data) return;
      if (result.data.action === "WAIT") return;
      await dumpOutlineResult(result, "./dump/outline/entry");
    },
  },
});
