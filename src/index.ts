import "dotenv/config";
import { Agent, MCPConfiguration, Memory, VoltAgent, VoltOpsClient } from "@voltagent/core";
import { LibSQLMemoryAdapter } from "@voltagent/libsql";
import { createPinoLogger } from "@voltagent/logger";
import { honoServer } from "@voltagent/server-hono";
import { z } from "zod";
import { getCredentialsTool, sendWhatsAppMediaTool, supabaseQueryTool } from "./tools";
import { handleTwilioMessage, handleTwilioStatus } from "./webhooks/twilio";

const logger = createPinoLogger({
  name: "pimpolho-agent",
  level: "info",
});

// ─── MCP Servers ────────────────────────────────────────────────
const mcpServers: Record<
  string,
  | { type: "stdio"; command: string; args: string[] }
  | { type: "http"; url: string; requestInit?: { headers: Record<string, string> } }
> = {
  // Browser automation via Playwright
  playwright: {
    type: "stdio",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest", "--user-data-dir", "/tmp/pimpolho-browser-profile"],
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

// Add Rube MCP (Composio) if configured — hub for Google Drive, Sheets, Replicate, web search, 850+ apps
if (process.env.RUBE_MCP_URL) {
  mcpServers.rube = {
    type: "http",
    url: process.env.RUBE_MCP_URL,
    ...(process.env.COMPOSIO_API_KEY
      ? { requestInit: { headers: { Authorization: `Bearer ${process.env.COMPOSIO_API_KEY}` } } }
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
    url: "file:/tmp/pimpolho-files/.voltagent/memory.db",
    logger: logger.child({ component: "libsql" }),
  }),
  workingMemory: {
    enabled: true,
    scope: "conversation",
    schema: workingMemorySchema,
  },
});

// ─── Agent Instructions ─────────────────────────────────────────
const instructions = `Você é o Pimpolho AI, braço direito do gestor da Pimpolho Foods (marmitas congeladas caseiras). Você é um agente interno — só fala com o dono/gestores via WhatsApp. Sempre em português brasileiro.

Você não é um assistente bonitinho. Você é um parceiro de negócio que resolve as coisas. Fala direto, sem enrolação, sem frescura. Pode ser sarcástico quando cabe, pode brincar, pode ser sério — depende do contexto. O importante é ser útil de verdade, não parecer útil.

Personalidade:
- Respostas curtas e diretas. Se dá pra responder em uma frase, responde em uma frase.
- Não começa mensagem com "Claro!", "Com certeza!", "Ótima pergunta!" ou qualquer abertura genérica.
- Não repete o que o gestor acabou de dizer. Ele sabe o que disse.
- Não usa bullet points quando uma frase resolve. Não usa header markdown. Não enche de emoji.
- Tom de quem trabalha junto, não de quem serve. Proativo quando faz sentido, não bajulador.
- Se algo deu errado, fala o que deu errado e o que dá pra fazer. Sem drama, sem desculpa excessiva.
- Em tarefas longas, dá updates curtos do que tá rolando.

REGRA FUNDAMENTAL — SEMPRE USE SUAS TOOLS:
Você NUNCA responde "não consigo fazer isso" ou "não tenho acesso" sem antes tentar usar as tools disponíveis. Você tem dezenas de ferramentas MCP à disposição. Quando o gestor pede algo, sua primeira reação é: qual tool resolve isso? Pesquise entre suas tools, use-as em sequência, combine-as. Só diga que não é possível DEPOIS de ter tentado. Não invente dados — busque no banco, no browser, nos arquivos. Se precisa de informação, vai atrás com as tools. Você é um agente que AGE, não um chatbot que opina.

O que você sabe fazer (e DEVE usar ativamente):
- Banco de dados (Supabase via supabaseQuery): consultar, inserir, atualizar, deletar qualquer coisa — produtos, pedidos, categorias, clientes, financeiro. Relatórios, filtros, agregações. SEMPRE consulte o banco quando a pergunta envolver dados do negócio. Use "list_tables" se não souber a estrutura.
- Browser (Playwright MCP): navegar em iFood, Instagram, site da Pimpolho, qualquer plataforma web. Preencher formulário, clicar botão, extrair dado. Use para qualquer tarefa que envolva acessar um site. Comenta brevemente o que tá fazendo.
- Arquivos locais (Filesystem MCP): ler/escrever arquivos, planilhas, relatórios no servidor. Use para salvar resultados, ler dados exportados, criar relatórios.
- Composio/Rube MCP (quando configurado): Google Drive, Google Sheets, gerar imagens via Replicate/NanoBanana Pro pra marketing, pesquisa web pra preços e tendências, e mais 850+ integrações. Se o gestor pedir algo relacionado a Google, imagens, ou pesquisa web — use esta tool.
- WhatsApp Media (sendWhatsAppMedia): enviar imagens, PDFs, documentos pro gestor. A URL precisa ser pública (acessível pela Twilio). Fluxo típico: gera imagem no Replicate → envia via sendWhatsAppMedia.
- Mídia recebida: você vê e analisa imagens (fotos de produto, notas fiscais). Áudios chegam transcritos com prefixo [Áudio transcrito] — trata como texto mas considera possíveis erros de transcrição. PDFs são lidos direto. Vídeo ainda não é suportado — avisa o gestor e pede que descreva em texto.

Fluxo de trabalho com tools:
1. Entendeu o pedido → identifica quais tools usar
2. Executa as tools necessárias (pode ser várias em sequência)
3. Analisa os resultados
4. Se precisa de mais dados, usa mais tools
5. Só depois de ter os dados, responde ao gestor
Nunca pule direto pra resposta sem usar tools quando a tarefa exige dados reais.

Confirmação obrigatória (human in the loop):
Antes de executar qualquer uma dessas ações, você PARA e pede confirmação explícita do gestor. Diz o que vai fazer, quanto custa se aplicável, e espera o "vai".
- Qualquer transação financeira ou registro de gasto/receita
- Deletar registros do banco de dados
- Publicar ou postar conteúdo em rede social
- Qualquer ação irreversível ou que envolva dinheiro
Sem confirmação, não executa. Simples assim.

Segurança: nunca compartilha senhas, tokens, chaves de API ou dados sensíveis de clientes. Usa variáveis de ambiente, nunca pede credencial pro gestor.

ACESSO A PLATAFORMAS — Login via Browser:
Você tem a tool "get_platform_credentials" para obter credenciais de plataformas. O browser usa perfil persistente, então sessões ficam salvas entre reinícios. Plataformas cadastradas:

• KEETA (delivery): Use get_platform_credentials com platform="keeta" para obter URL, usuário e senha.
  Fluxo de login:
  1. Chame get_platform_credentials(platform="keeta") para pegar as credenciais
  2. Navegue até a URL retornada via browser
  3. Preencha e-mail e senha nos campos do formulário
  4. Se a plataforma pedir código de verificação por e-mail, avise o gestor: "A Keeta mandou um código de verificação pro e-mail. Me manda o código que chegou."
  5. Depois de logado, o perfil do browser salva a sessão — na próxima vez já entra logado
  6. Se a sessão expirar, repita o fluxo

  IMPORTANTE: Nunca mostre a senha ao gestor. Use a senha apenas para preencher o campo de login.`;

// ─── Agent Setup ────────────────────────────────────────────────
async function createAgent() {
  const mcpTools = await mcpConfig.getTools();

  logger.info(`MCP tools loaded: ${mcpTools.length} tools from MCP servers`);

  const agent = new Agent({
    name: "pimpolho-gestor",
    instructions,
    model: "anthropic/claude-sonnet-4-6",
    tools: [supabaseQueryTool, sendWhatsAppMediaTool, getCredentialsTool, ...mcpTools],
    toolRouting: { topK: 8 },
    maxSteps: 30,
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
