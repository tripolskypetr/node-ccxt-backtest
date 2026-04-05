import { singleshot } from "functools-kit";
import { Ollama } from "ollama";

const getOllama = singleshot(
  () => {
    console.log("CTOR");
    return new Ollama({
      host: "https://ollama.com",
      headers: {
        Authorization: `Bearer ${process.env.OLLAMA_TOKEN}`,
      },
    });
  }
);

export { getOllama }
