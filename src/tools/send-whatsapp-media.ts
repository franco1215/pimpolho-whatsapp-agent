import { createTool } from "@voltagent/core";
import Twilio from "twilio";
import { z } from "zod";

const twilioClient = Twilio(
  process.env.TWILIO_ACCOUNT_SID || "",
  process.env.TWILIO_AUTH_TOKEN || "",
);

export const sendWhatsAppMediaTool = createTool({
  name: "sendWhatsAppMedia",
  description:
    "Envia uma imagem, documento ou outra mídia de volta ao gestor via WhatsApp. Use quando precisar enviar uma imagem gerada, um relatório em PDF, ou qualquer arquivo de mídia. A mediaUrl precisa ser uma URL pública acessível pela Twilio.",
  parameters: z.object({
    mediaUrl: z
      .string()
      .url()
      .describe("URL pública da mídia a enviar (imagem, PDF, etc)"),
    caption: z
      .string()
      .optional()
      .describe("Legenda/texto para acompanhar a mídia"),
  }),
  execute: async ({ mediaUrl, caption }, options) => {
    const userId = options?.userId;
    if (!userId) {
      return {
        success: false,
        message: "Não foi possível identificar o destinatário (userId não disponível).",
      };
    }

    const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || "";

    try {
      await twilioClient.messages.create({
        from: `whatsapp:${fromNumber}`,
        to: `whatsapp:${userId}`,
        body: caption || "",
        mediaUrl: [mediaUrl],
      });

      return {
        success: true,
        message: `Mídia enviada com sucesso para ${userId}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Erro desconhecido",
        message: "Falha ao enviar mídia via WhatsApp.",
      };
    }
  },
});
