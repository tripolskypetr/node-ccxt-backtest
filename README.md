# 🧿 AI Fundamental Analysis via Reason + Act Agent Swarm

> A trading strategy built on the ReAct (Reason + Act) pattern: a swarm of LLM agents independently researches the market using iterative web search, then a portfolio manager LLM synthesises all findings into a single directional signal. No hardcoded indicators. No rule-based logic. Every decision is a reasoned conclusion.

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/tripolskypetr/node-ccxt-backtest)

## 💡 The Core Idea

Traditional algorithmic trading uses fixed rules: _"if RSI < 30 and price crosses MA — buy"_. This project replaces the rules with reasoning.

The LLM is not asked _"what is the RSI?"_ — it is asked _"should I buy Bitcoin today, and why?"_ It then goes and finds out.

The architecture is a direct implementation of the **ReAct pattern**:

```
while (no_answer) {
  Reason: "What do I need to know to answer this?"
  Act:    web_search(query)
  Observe: read the results
}
Answer: synthesise everything into a structured conclusion
```

Each of the 8 specialist agents runs its own ReAct loop in an isolated conversation session (`keepMessages: Infinity`). They do not share context — they work independently and in parallel, then hand their reports to a synthesiser.

## 🕵️ Equity Analysis Framework Applied to Crypto

The 8 analysts are modelled after the standard sections of a company's financial due diligence — applied to Bitcoin's on-chain equivalents:

| Financial Concept | Crypto Equivalent | What the Agent Searches |
|---|---|---|
| **Balance Sheet** | On-chain reserves | Exchange outflows, LTH supply, illiquid supply ratio, HODL waves |
| **Cash Flow Statement** | Capital flows | ETF net inflows, miner selling pressure, stablecoin exchange inflows, OTC volume |
| **Fundamentals / Valuation** | Network health | Hash rate, MVRV ratio, NVT ratio, stock-to-flow model |
| **Income Statement** | Network revenue | Transaction fees, Lightning capacity, Ordinals activity, DeFi TVL |
| **Insider Transactions** | Smart money | MicroStrategy buys, BlackRock ETF holdings, Grayscale GBTC, government wallets |
| **Asset News** | Market sentiment | Regulatory events, exchange hacks, institutional adoption |
| **Global Macro** | Macro environment | Fed rate decisions, CPI surprises, DXY, fear & greed index, M2 money supply |
| **Price History** | Technical context | OHLCV history, volume spikes, breakout confirmation |

This framing is deliberate: it forces the LLM to cover the market from 8 distinct angles that professional fund analysts would use, with no overlap between them.

## 🧠 Anti-Bias Measures in the Agent Prompts

Getting an LLM to do honest research — not optimistic summaries — required explicit instructions baked into every agent's system prompt:

- **No look-ahead bias** — the agent is given a specific `date` and told: _"only use sources you can confirm were published before this date"_
- **Reject undated sources** — _"if you cannot determine the publication date from the document, do not use it"_
- **No marketing** — _"bias toward negative signals; ignore bullish framing in the source material"_
- **Multiple queries required** — _"make several searches; do not base the report on a single article"_
- **No hallucination** — _"write only what you actually found; do not invent figures"_

## 🧠 Portfolio Manager: Synthesis, Not Voting

A naive approach would count how many of the 8 reports are bullish vs bearish and take the majority. This project does not do that.

The synthesising `ResearchOutline` sends all 8 reports to the LLM with a different instruction:

> *"Perceive the reports as a single picture, not a list of bullet points. Ask yourself: what story do they tell together? One strong signal — a macro regime shift, a large institutional flow — can outweigh several weak ones. Contradictions are normal: resolve them by asking which force is stronger right now, not who has more arguments. Act only when the picture forms a coherent story. If the picture is blurry — choose WAIT."*

The model is explicitly told to reason through contradictions, not paper over them.

## 🔬 Two-Stage Decision Pipeline

Research alone is not enough to place a trade. Even a correct fundamental signal can arrive at a bad technical moment — the price just spiked 3% and chasing is dangerous. The pipeline separates these concerns:

```
Every 1m candle
  │
  ├─ Stage 1: RESEARCH  (daily, cached to disk)
  │     8 agents run ReAct loops in parallel
  │     Portfolio manager synthesises → BUY / SELL / WAIT
  │     If WAIT → stop, no order
  │
  └─ Stage 2: POSITION  (hourly, cached in memory)
        Last 240 one-minute candles → Markdown table → LLM
        Technical entry filter: local extremes + momentum
        → OPEN / WAIT
        If WAIT → stop, no order
```

**Stage 1** answers: _"is the market fundamentally set up for a move?"_  
**Stage 2** answers: _"is right now a good moment to enter, given the candle data?"_

## 📐 Technical Entry Filter (Stage 2 in Detail)

`PositionOutline` receives a step-by-step reasoning prompt — not just the data:

1. Find the local minimum among the last 30–60 candles
2. Find the local maximum among the same candles
3. Calculate `distance_to_high = (local_high − current_price) / current_price × 100`
4. Evaluate momentum: are the last 5–10 candles predominantly in the signal direction?

**OPEN** only when distance ≥ 1.5% AND momentum confirms AND price has not just made a sharp spike.  
**WAIT** otherwise.

The LLM must write its reasoning with explicit values — `local_min`, `local_high`, `current_price`, `distance_to_high` — before returning the decision. This is chain-of-thought enforced by the schema.

## 🏗️ Structured Output via Tool-Call Forcing

Getting a language model to return valid, schema-conforming JSON reliably is non-trivial. This project uses `OllamaOutlineToolCompletion`:

1. The schema is wrapped into a `provide_answer` tool definition
2. The model is told in a system prompt: _"ALWAYS call provide_answer. NEVER respond with plain text."_
3. If the model ignores the tool and responds with text — a follow-up user message is injected and the request retries
4. Malformed JSON is repaired with `jsonrepair` before schema validation
5. Up to 3 attempts before throwing
6. Thinking tokens (`think: true`) are preserved on the result object as `_thinking`

## 🌍 Environment Variables

```env
OLLAMA_TOKEN=your_ollama_token_here

# Optional
CC_TELEGRAM_TOKEN=your_bot_token_here
CC_TELEGRAM_CHANNEL=-100123456789
CC_WWWROOT_PORT=60050
```

## 📋 Running

See [DOCS.md](./DOCS.md) for CLI flags (`--backtest`, `--paper`, `--live`, `--pine`, `--dump`).

```bash
npm start -- --backtest --symbol BTCUSDT --strategy feb_2026_strategy \
  --exchange ccxt-exchange --frame feb_2026_frame \
  ./content/feb_2026.strategy/feb_2026.strategy.ts
```
