/**
 * POC-001: Server-Side Runtime Secret Loader & Skills MCP Capability Registry
 * Gate Slice 4 / Decision OD-28 & Slice 5 / Decision OD-29
 *
 * Safely loads runtime API secrets from local credential files into server memory:
 * - GeminiAPIKey.env                  -> GEMINI_API
 * - Groq_Key.env                      -> GROQ_API
 * - GMAPSAPIKey.env                   -> GOOGLE_MAPS
 * - Alpaca_Key.env / Alpaca_Secret.env -> ALPACA_BROKERAGE
 * - Eulerpool.env                     -> EULERPOOL_MACRO
 * - GithubPersonalAccessTokenFORAG.env-> GITHUB_SYNC
 * - HuggingFaceAPI.env                -> HUGGINGFACE_SERVERLESS
 * - MistralAPI.env                    -> MISTRAL_API
 * - OllamaAPIKey.env                  -> OLLAMA_LOCAL
 * - OPENRouterAPI.env                 -> OPENROUTER_GATEWAY
 * - Postgres.env                      -> POSTGRES_STORE
 * - TinyFish.env                      -> TINYFISH_CRAWLER
 *
 * Strict Security Invariants:
 * 1. AI agents, assistants, logs, and API envelopes must NEVER print, log, or serialize secret values.
 * 2. Only boolean status (key_configured: true/false) is exposed to telemetry or health endpoints.
 * 3. Secret files remain strictly .gitignore'd and are never committed.
 * 4. All file paths use explicit resolution independent of working directory.
 */

import fs from 'node:fs';
import path from 'node:path';

export type SupportedSecretProvider =
  | 'GEMINI_API'
  | 'GROQ_API'
  | 'GOOGLE_MAPS'
  | 'ALPACA_BROKERAGE'
  | 'EULERPOOL_MACRO'
  | 'GITHUB_SYNC'
  | 'HUGGINGFACE_SERVERLESS'
  | 'MISTRAL_API'
  | 'OLLAMA_LOCAL'
  | 'OPENROUTER_GATEWAY'
  | 'POSTGRES_STORE'
  | 'TINYFISH_CRAWLER';

export interface SkillsMcpCapabilityItem {
  readonly capability_id: string;
  readonly provider_key: SupportedSecretProvider;
  readonly skill_category:
    | 'REASONING_LLM'
    | 'HIGH_SPEED_INFERENCE'
    | 'LOGISTICS_GEOCODING'
    | 'BROKERAGE_EXECUTION'
    | 'MACRO_DATA_FEED'
    | 'VERSION_CONTROL'
    | 'EMBEDDING_AND_NLP'
    | 'LOCAL_INFERENCE_CLUSTER'
    | 'MULTI_MODEL_GATEWAY'
    | 'PERSISTENCE_TRANSACTIONAL'
    | 'SOURCE_CAPTURE_CRAWLER';
  readonly env_file_names: readonly string[];
  readonly env_variables: readonly string[];
  readonly is_configured: boolean;
  readonly concurrency_mode: 'CONCURRENT' | 'EXCLUSIVE';
  readonly description: string;
  readonly associated_agent_roles: readonly string[];
}

const providerKeyStore: Map<SupportedSecretProvider, string> = new Map();

function parseEnvLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const eqIdx = trimmed.indexOf('=');
  let val = eqIdx !== -1 ? trimmed.slice(eqIdx + 1).trim() : trimmed;
  // Strip surrounding quotes if present
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1).trim();
  }
  return val.length > 0 ? val : null;
}

function resolveSecretFilePath(fileName: string, baseDir?: string): string | null {
  const candidates = [
    baseDir ? path.resolve(baseDir, fileName) : null,
    path.resolve(process.cwd(), fileName),
    path.resolve('D:/Market HFT OS', fileName),
    path.resolve('d:/Market HFT OS', fileName)
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Inaccessible path
    }
  }
  return null;
}

interface SecretFileMapping {
  provider: SupportedSecretProvider;
  fileNames: string[];
  envVars: string[];
  category: SkillsMcpCapabilityItem['skill_category'];
  concurrency: 'CONCURRENT' | 'EXCLUSIVE';
  description: string;
  roles: string[];
}

const SECRET_MAPPINGS: SecretFileMapping[] = [
  {
    provider: 'GEMINI_API',
    fileNames: ['GeminiAPIKey.env'],
    envVars: ['GEMINI_API_KEY'],
    category: 'REASONING_LLM',
    concurrency: 'CONCURRENT',
    description: 'Google Gemini multimodal reasoning and large context document analysis',
    roles: ['ResearchSynthesisAgent', 'CustomerTaskAgent', 'AdversarialTaskAgent']
  },
  {
    provider: 'GROQ_API',
    fileNames: ['Groq_Key.env'],
    envVars: ['GROQ_API_KEY'],
    category: 'HIGH_SPEED_INFERENCE',
    concurrency: 'CONCURRENT',
    description: 'Groq ultra-fast LPU inference desk for Llama-3 token streaming',
    roles: ['ResearchSynthesisAgent', 'SellerTaskAgent']
  },
  {
    provider: 'GOOGLE_MAPS',
    fileNames: ['GMAPSAPIKey.env'],
    envVars: ['GOOGLE_MAPS_API_KEY'],
    category: 'LOGISTICS_GEOCODING',
    concurrency: 'CONCURRENT',
    description: 'Google Maps Routes, Geocoding & Distance Matrix API for logistics transit modeling',
    roles: ['LogisticsTaskAgent', 'SupplyTaskAgent']
  },
  {
    provider: 'ALPACA_BROKERAGE',
    fileNames: ['Alpaca_Key.env', 'Alpaca_Secret.env'],
    envVars: ['APCA_API_KEY_ID', 'APCA_API_SECRET_KEY'],
    category: 'BROKERAGE_EXECUTION',
    concurrency: 'EXCLUSIVE',
    description: 'Alpaca paper simulation execution engine and portfolio accounting',
    roles: ['ExecutionDeskAgent', 'PortfolioSupervisor']
  },
  {
    provider: 'EULERPOOL_MACRO',
    fileNames: ['Eulerpool.env'],
    envVars: ['EULERPOOL_API_KEY'],
    category: 'MACRO_DATA_FEED',
    concurrency: 'CONCURRENT',
    description: 'Eulerpool global macroeconomic interest rate, sovereign yield, and inflation series',
    roles: ['MacroLateralWorker', 'UnitEconomicsTaskAgent']
  },
  {
    provider: 'GITHUB_SYNC',
    fileNames: ['GithubPersonalAccessTokenFORAG.env'],
    envVars: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    category: 'VERSION_CONTROL',
    concurrency: 'EXCLUSIVE',
    description: 'GitHub repository synchronization and governance ADR ledger commits',
    roles: ['DevOpsSupervisorAgent']
  },
  {
    provider: 'HUGGINGFACE_SERVERLESS',
    fileNames: ['HuggingFaceAPI.env'],
    envVars: ['HUGGINGFACE_API_KEY', 'HF_TOKEN'],
    category: 'EMBEDDING_AND_NLP',
    concurrency: 'CONCURRENT',
    description: 'HuggingFace serverless sentence embeddings and classification pipelines',
    roles: ['ReviewMinerAgent', 'AdversarialTaskAgent']
  },
  {
    provider: 'MISTRAL_API',
    fileNames: ['MistralAPI.env'],
    envVars: ['MISTRAL_API_KEY'],
    category: 'REASONING_LLM',
    concurrency: 'CONCURRENT',
    description: 'Mistral AI advanced European multilingual reasoning and embedding substrate',
    roles: ['CustomerTaskAgent', 'AdversarialTaskAgent']
  },
  {
    provider: 'OLLAMA_LOCAL',
    fileNames: ['OllamaAPIKey.env'],
    envVars: ['OLLAMA_API_KEY', 'OLLAMA_HOST'],
    category: 'LOCAL_INFERENCE_CLUSTER',
    concurrency: 'EXCLUSIVE',
    description: 'Local airgapped Ollama cluster for zero-egress proprietary synthesis',
    roles: ['LocalAirgappedWorker', 'ReviewMinerAgent']
  },
  {
    provider: 'OPENROUTER_GATEWAY',
    fileNames: ['OPENRouterAPI.env'],
    envVars: ['OPENROUTER_API_KEY'],
    category: 'MULTI_MODEL_GATEWAY',
    concurrency: 'CONCURRENT',
    description: 'OpenRouter unified routing gateway across Claude, GPT-4, and open-weights models',
    roles: ['MetaOrchestratorAgent']
  },
  {
    provider: 'POSTGRES_STORE',
    fileNames: ['Postgres.env'],
    envVars: ['DATABASE_URL', 'PGPASSWORD'],
    category: 'PERSISTENCE_TRANSACTIONAL',
    concurrency: 'CONCURRENT',
    description: 'PostgreSQL 16.8 immutable dual-ledger and bitemporal evidence storage',
    roles: ['EvidenceStoreSubstrate', 'ActualsGuard']
  },
  {
    provider: 'TINYFISH_CRAWLER',
    fileNames: ['TinyFish.env'],
    envVars: ['TINYFISH_API_KEY'],
    category: 'SOURCE_CAPTURE_CRAWLER',
    concurrency: 'CONCURRENT',
    description: 'TinyFish structured web scraper and anti-bot HTML source capture substrate',
    roles: ['SourceCaptureWorker', 'MediaChatterWorker']
  }
];

export function loadServerSecrets(baseDir?: string): {
  geminiConfigured: boolean;
  groqConfigured: boolean;
  mapsConfigured: boolean;
  allConfiguredCount: number;
} {
  for (const item of SECRET_MAPPINGS) {
    for (let fIdx = 0; fIdx < item.fileNames.length; fIdx++) {
      const fileName = item.fileNames[fIdx];
      const envVar = item.envVars[fIdx] || item.envVars[0];
      const filePath = resolveSecretFilePath(fileName, baseDir);
      if (filePath) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const lines = content.split(/\r?\n/);
          for (const line of lines) {
            const parsed = parseEnvLine(line);
            if (parsed) {
              if (fIdx === 0) {
                providerKeyStore.set(item.provider, parsed);
              }
              if (!process.env[envVar]) {
                process.env[envVar] = parsed;
              }
              break;
            }
          }
        } catch {
          // Fail-safe: do not expose path or error contents with sensitive names
        }
      }
    }
  }

  return {
    geminiConfigured: isProviderKeyConfigured('GEMINI_API'),
    groqConfigured: isProviderKeyConfigured('GROQ_API'),
    mapsConfigured: isProviderKeyConfigured('GOOGLE_MAPS'),
    allConfiguredCount: providerKeyStore.size
  };
}

export function isProviderKeyConfigured(provider: SupportedSecretProvider): boolean {
  if (providerKeyStore.has(provider)) return true;
  const match = SECRET_MAPPINGS.find((m) => m.provider === provider);
  if (match) {
    for (const envVar of match.envVars) {
      if (Boolean(process.env[envVar])) return true;
    }
  }
  return false;
}

export function getProviderKey(provider: SupportedSecretProvider): string | undefined {
  if (providerKeyStore.has(provider)) return providerKeyStore.get(provider);
  const match = SECRET_MAPPINGS.find((m) => m.provider === provider);
  if (match) {
    for (const envVar of match.envVars) {
      if (process.env[envVar]) return process.env[envVar];
    }
  }
  return undefined;
}

export function getSkillsMcpRegistry(baseDir?: string): readonly SkillsMcpCapabilityItem[] {
  return SECRET_MAPPINGS.map((item) => {
    let configured = isProviderKeyConfigured(item.provider);
    if (!configured) {
      // Check if files exist on disk
      const filesExist = item.fileNames.every((f) => Boolean(resolveSecretFilePath(f, baseDir)));
      if (filesExist) configured = true;
    }

    return {
      capability_id: `skill:mcp:${item.provider.toLowerCase().replace(/_/g, '-')}`,
      provider_key: item.provider,
      skill_category: item.category,
      env_file_names: item.fileNames,
      env_variables: item.envVars,
      is_configured: configured,
      concurrency_mode: item.concurrency,
      description: item.description,
      associated_agent_roles: item.roles
    };
  });
}

export function clearServerSecretsForTesting(): void {
  providerKeyStore.clear();
}

export function setMockProviderKeyForTesting(provider: SupportedSecretProvider, key: string): void {
  providerKeyStore.set(provider, key);
}
