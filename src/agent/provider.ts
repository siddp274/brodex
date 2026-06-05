// Provider selection: read env and construct the configured provider. Keeps the
// loop provider-agnostic. Phase 1 wires Azure Foundry; others slot in here.
import type { Provider } from "./types.ts"
import { createAzureProvider } from "./providers/azure.ts"
import { createMockProvider, type MockTurn } from "./providers/mock.ts"

export function createProviderFromEnv(env: NodeJS.ProcessEnv = process.env): Provider {
  const which = (env.BRODEX_PROVIDER ?? "azure").toLowerCase()

  switch (which) {
    case "mock": {
      // Dev/test provider — no API key needed. Optionally script turns via
      // BRODEX_MOCK_TURNS (JSON array of {text, toolCalls}). Defaults to a
      // single canned reply.
      let turns: MockTurn[] = [{ text: "(mock) provider is active — set BRODEX_PROVIDER=azure to use a real model." }]
      if (env.BRODEX_MOCK_TURNS) {
        try {
          turns = JSON.parse(env.BRODEX_MOCK_TURNS) as MockTurn[]
        } catch {
          /* keep default */
        }
      }
      return createMockProvider(turns)
    }
    case "azure": {
      const baseURL = env.AZURE_OPENAI_BASE_URL
      const apiKey = env.AZURE_OPENAI_API_KEY
      const model = env.BRODEX_MODEL ?? env.AZURE_OPENAI_DEPLOYMENT
      if (!baseURL) throw new Error("AZURE_OPENAI_BASE_URL is not set")
      if (!apiKey) throw new Error("AZURE_OPENAI_API_KEY is not set")
      if (!model) throw new Error("BRODEX_MODEL (or AZURE_OPENAI_DEPLOYMENT) is not set")
      return createAzureProvider({
        baseURL,
        apiKey,
        apiVersion: env.AZURE_OPENAI_API_VERSION,
        model,
      })
    }
    default:
      throw new Error(`unknown BRODEX_PROVIDER: ${which}`)
  }
}
