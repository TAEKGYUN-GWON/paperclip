export const type = "ollama_local";
export const label = "Ollama (local)";

export const models: Array<{ id: string; label: string }> = [];

export const agentConfigurationDoc = `# ollama_local agent configuration

Adapter: ollama_local

Use when:
- You want Paperclip to run a local LLM via Ollama as the agent runtime
- You want to use open-source models (Llama, Mistral, Qwen, DeepSeek, etc.) locally
- You have the Ollama daemon running on your machine (default: http://localhost:11434)
- You want zero API costs with fully local inference

Don't use when:
- Ollama is not installed or the daemon is not running
- You need tool use / function calling (limited model support in Ollama)
- You need session resume across heartbeats (Ollama is stateless per request)

Core fields:
- model (string, required): Ollama model name (e.g., llama3.2, qwen2.5-coder, deepseek-r1)
- baseUrl (string, optional): Ollama API base URL (default: http://localhost:11434)
- instructionsFilePath (string, optional): absolute path to a markdown instructions file for the system prompt
- promptTemplate (string, optional): user prompt template
- timeoutSec (number, optional): request timeout in seconds (0 = no timeout)
- env (object, optional): KEY=VALUE environment variables

Notes:
- Run \`ollama list\` to see available models on your machine
- Run \`ollama pull <model>\` to download a model before using it
- Models with tool support: llama3.1, llama3.2, qwen2.5, mistral-nemo
- Ollama does not persist conversation history between runs; each heartbeat is a fresh request
`;
