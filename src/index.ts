import "dotenv/config";
import { Agent, Memory, VoltAgent, VoltOpsClient } from "@voltagent/core";
import { LibSQLMemoryAdapter } from "@voltagent/libsql";
import { createPinoLogger } from "@voltagent/logger";
import { honoServer } from "@voltagent/server-hono";
import { z } from "zod";
import {
  checkOrderStatusTool,
  createOrderTool,
  listMenuItemsTool,
} from "./tools";
import { handleTwilioMessage, handleTwilioStatus } from "./webhooks/twilio";

const logger = createPinoLogger({
  name: "pimpolho-whatsapp",
  level: "info",
});

// Working memory para manter estado da conversa
const workingMemorySchema = z.object({
  orders: z
    .array(
      z.object({
        menuItemId: z.number(),
        itemName: z.string(),
        quantity: z.number(),
        price: z.number(),
      }),
    )
    .default([]),
  deliveryAddress: z.string().default(""),
  customerNotes: z.string().default(""),
  orderStatus: z
    .enum(["selecting", "address_needed", "completed"])
    .default("selecting"),
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

const agent = new Agent({
  name: "pimpolho-foods",
  instructions: `Você é o assistente virtual da Pimpolho Foods, especializada em marmitas congeladas caseiras.

Seu tom é amigável, acolhedor e direto. Use português brasileiro natural. Pode usar emojis com moderação.

Fluxo do Pedido:
1. Se o carrinho (orders) estiver vazio, cumprimente o cliente e mostre o cardápio usando a tool listMenuItems
2. Quando o cliente escolher itens:
   - Adicione ao carrinho na working memory
   - Mantenha orderStatus como "selecting"
   - Pergunte se deseja mais alguma coisa
3. Quando o cliente não quiser mais itens:
   - Mude orderStatus para "address_needed"
   - Peça o endereço de entrega
   - Quando receber o endereço, atualize deliveryAddress
   - Mude orderStatus para "completed"
   - Execute a tool createOrder com os itens e endereço
   - Confirme o pedido e limpe a working memory
4. Se o cliente perguntar sobre um pedido existente:
   - Use a tool checkOrderStatus

Informações da Pimpolho Foods:
- Especialidade: marmitas congeladas caseiras
- Entrega para toda a região
- Pedido mínimo: consultar cardápio
- Formas de pagamento: PIX, cartão (na entrega)
- Horário de entrega: verificar disponibilidade

Sempre seja prestativo e sugira combos ou promoções quando possível.`,
  model: "openai/gpt-4o-mini",
  tools: [listMenuItemsTool, createOrderTool, checkOrderStatusTool],
  memory,
});

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
          service: "pimpolho-whatsapp-bot",
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
