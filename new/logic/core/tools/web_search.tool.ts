import { addTool, commitToolOutput, execute } from "agent-swarm-kit";
import { getOllama } from "../../config/ollama";
import { str } from "functools-kit";
import { ToolName } from "../../enum/ToolName";

const SEARCH_MAX_RESULTS = 10;

addTool({
  toolName: ToolName.WebSearchTool,
  isAvailable: () => true,
  call: async ({ toolId, params, clientId, agentName, isLast }) => {
    if (!params.query) {
      await commitToolOutput(
        toolId,
        "The `query` argument is required. Call `web_search` with a search query to get results.",
        clientId,
        agentName,
      );
    }
    if (params.query) {
      console.log(`Searching ${params.query}`);
      const ollama = getOllama();
      const { results } = await ollama.webSearch({
        query: String(params.query),
        maxResults: SEARCH_MAX_RESULTS,
      });
      await commitToolOutput(toolId, JSON.stringify(results, null, 2), clientId, agentName);
    }
    if (isLast) {
      await execute("", clientId, agentName);
    }
  },
  type: "function",
  function: {
    name: "web_search",
    description: str.space(
      "Search the web for current information.",
      "Use this when you need up-to-date information that may not be in your training data.",
    ),
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to look up on the web",
        },
      },
      required: ["query"],
    },
  },
});
