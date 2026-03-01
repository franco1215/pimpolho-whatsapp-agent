import "dotenv/config";
import { Agent, MCPConfiguration, Memory, VoltAgent, VoltOpsClient } from "@voltagent/core";
import { LibSQLMemoryAdapter } from "@voltagent/libsql";
import { createPinoLogger } from "@voltagent/logger";
import { honoServer } from "@voltagent/server-hono";
import { z } from "zod";
import { supabaseQueryTool } from "./tools";
import { handleTwilioMessage, handleTwilioStatus } from "./webhooks/twilio";

const logger = createPinoLogger({
  name: "pimpolho-agent",
  level: "info",
});

// ─── MCP Servers ────────────────────────────────────────────────
// Build servers config, adding Rube only if URL is configured
const mcpServers: Record<string, { type: "stdio"; command: string; args: string[] } | { type: "http"; url: string; requestInit?: { headers: Record<string, string> } }> = {
  // Browser automation via Playwright
  playwright: {
    type: "stdio",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
  },

  // Filesystem access for local files
  filesystem: {
    type: "stdio",
    command: "npx",
    args: [
      "-y",
      "@modelcontextprotocol/server-filesystem",
      process.env.FILES_ROOT_DIR || "/tmp/pimpolho-files",
    ],
  },
};

// Add Rube MCP (Composio) if configured
if (process.env.RUBE_MCP_URL) {
  mcpServers.rube = {
    type: "http",
    url: process.env.RUBE_MCP_URL,
    ...(process.env.COMPOSIO_API_KEY
      ? { requestInit: { headers: { "X-API-Key": process.env.COMPOSIO_API_KEY } } }
      : {}),
  };
}

const mcpConfig = new MCPConfiguration({ servers: mcpServers });

// ─── Working Memory ─────────────────────────────────────────────
const workingMemorySchema = z.object({
  currentTask: z.string().default(""),
  notes: z.array(z.string()).default([]),
  lastPlatformAccessed: z.string().default(""),
});

const memory = new Memory({
  storage: new LibSQLMemoryAdapter({
    url: "file:./.voltagent/memory.db",
    logger: logger.child({ component: "libsql" }),
  }),
  workingMemory: {
    enabled: true,
    scope: "conversation",
    schema: workingMemorySchema,
  },
});

// ─── Agent Setup ────────────────────────────────────────────────
async function createAgent() {
  // Get all MCP tools
  const mcpTools = await mcpConfig.getTools();

  logger.info(`MCP tools loaded: ${mcpTools.length} tools from MCP servers`);

  const agent = new Agent({
    name: "pimpolho-gestor",
    instructions: `Você é o assistente de gestão da Pimpolho Foods, uma empresa de marmitas congeladas caseiras.

Você é um agente INTERNO — conversa com o dono/gestores do restaurante, não com clientes.

## Suas Capacidades

### 1. Banco de Dados (Supabase)
- Consultar produtos, pedidos, categorias, clientes
- Inserir e atualizar registros
- Gerar relatórios simples
- Use a tool "supabaseQuery" para isso

### 2. Browser (Playwright)
- Navegar em sites e plataformas
- Acessar o iFood para gerenciar cardápio
- Acessar o Instagram para ver/gerenciar posts
- Acessar o site próprio do Pimpolho (meu-gestor)
- Acessar o WhatsApp Business Web
- Preencher formulários, clicar em botões, extrair informações de páginas

### 3. Arquivos Locais
- Ler e escrever arquivos no servidor
- Acessar planilhas, documentos, imagens

### 4. Rube/Composio (quando configurado)
- Gerar imagens para posts de redes sociais
- Criar vídeos curtos
- Acessar Google Sheets
- Integrar com 600+ aplicativos

## Diretrizes

- Fale sempre em português brasileiro, tom profissional mas amigável
- Seja proativo: sugira ações quando fizer sentido
- Quando usar o browser, descreva o que está fazendo passo a passo
- Se algo der errado, explique claramente e sugira alternativas
- Nunca compartilhe senhas ou tokens — use os que estão nas variáveis de ambiente
- Ao acessar plataformas, tome cuidado para não alterar dados sem confirmação do usuário

## Contexto do Negócio
- Pimpolho Foods: marmitas congeladas caseiras
- Plataformas: iFood, site próprio, Instagram, WhatsApp Business
- Banco de dados: Supabase com tabelas de produtos, pedidos, categorias, cupons`,
    model: "openai/gpt-4o-mini",
    tools: [supabaseQueryTool, ...mcpTools],
    memory,
  });

  return agent;
}

// ─── Server Bootstrap ───────────────────────────────────────────
async function main() {
  const agent = await createAgent();

  new VoltAgent({
    agents: {
      agent,
    },
    server: honoServer({
      configureApp: (app) => {
        // Twilio WhatsApp webhook (POST)
        app.post("/webhook/twilio", async (c) => {
          return handleTwilioMessage(c, agent);
        });

        // Twilio status callback
        app.post("/webhook/twilio/status", async (c) => {
          return handleTwilioStatus(c);
        });

        // Health check
        app.get("/health", (c) => {
          return c.json({
            status: "healthy",
            service: "pimpolho-gestor",
            timestamp: new Date().toISOString(),
          });
        });
      },
    }),
    logger,
    voltOpsClient: new VoltOpsClient({
      publicKey: process.env.VOLTAGENT_PUBLIC_KEY || "",
      secretKey: process.env.VOLTAGENT_SECRET_KEY || "",
    }),
  });
}

main().catch((err) => {
  logger.error("Failed to start agent:", err);
  process.exit(1);
});
