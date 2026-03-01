import type { Agent } from "@voltagent/core";
import type { UIMessage } from "ai";
import type { Context } from "hono";
import Twilio from "twilio";
import type { TwilioIncomingMessage } from "../types/twilio";
import { transcribeAudio } from "../utils/audio-transcriber";
import { extractMedia, fetchMediaAsDataUrl } from "../utils/media-fetcher";
import { splitMessage } from "../utils/message-splitter";

const twilioClient = Twilio(
  process.env.TWILIO_ACCOUNT_SID || "",
  process.env.TWILIO_AUTH_TOKEN || "",
);

// Fix URL-decoded "+" → space issue in form-urlencoded parsing.
// Twilio sends "whatsapp:+5511..." but "+" decodes as space → "whatsapp: 5511..."
function normalizeWhatsAppNumber(raw: string): string {
  return raw.replace(/^whatsapp:\s*(\d)/, "whatsapp:+$1");
}

// Extract phone number from Twilio's "whatsapp:+55..." format
function extractPhone(twilioFrom: string): string {
  return normalizeWhatsAppNumber(twilioFrom).replace("whatsapp:", "");
}

// Send text message back via Twilio WhatsApp
async function sendTwilioMessage(to: string, body: string): Promise<boolean> {
  try {
    const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || "";
    await twilioClient.messages.create({
      from: `whatsapp:${fromNumber}`,
      to, // already in "whatsapp:+55..." format
      body,
    });
    return true;
  } catch (error) {
    console.error("Failed to send Twilio message:", error);
    return false;
  }
}

// Send media message via Twilio WhatsApp
async function sendTwilioMedia(
  to: string,
  body: string,
  mediaUrl: string,
): Promise<boolean> {
  try {
    const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || "";
    await twilioClient.messages.create({
      from: `whatsapp:${fromNumber}`,
      to,
      body,
      mediaUrl: [mediaUrl],
    });
    return true;
  } catch (error) {
    console.error("Failed to send Twilio media:", error);
    return false;
  }
}

// Process message in background (media handling, AI generation, response)
async function processMessage(
  message: TwilioIncomingMessage,
  agent: Agent,
): Promise<void> {
  const from = normalizeWhatsAppNumber(message.From);
  const userPhone = extractPhone(from);
  const numMedia = parseInt(message.NumMedia || "0", 10);
  const userText = message.Body?.trim() || "";

  // Build UIMessage parts
  const parts: UIMessage["parts"] = [];

  // Add text content (including location if present)
  let textContent = userText;

  if (message.Latitude && message.Longitude) {
    const locationStr = `[Localização compartilhada: lat=${message.Latitude}, lng=${message.Longitude}]`;
    textContent = textContent ? `${textContent}\n\n${locationStr}` : locationStr;
  }

  if (message.ButtonText) {
    const buttonStr = `[Botão pressionado: ${message.ButtonText}]`;
    textContent = textContent ? `${textContent}\n\n${buttonStr}` : buttonStr;
  }

  if (textContent) {
    parts.push({ type: "text", text: textContent });
  }

  // Process media attachments
  if (numMedia > 0) {
    const mediaItems = extractMedia(message, numMedia);

    for (const media of mediaItems) {
      if (media.contentType.startsWith("image/")) {
        // Images → base64 data URL
        const dataUrl = await fetchMediaAsDataUrl(media);
        if (dataUrl) {
          parts.push({
            type: "file",
            mediaType: media.contentType,
            url: dataUrl,
          });
        }
      } else if (media.contentType.startsWith("audio/")) {
        // Audio → transcribe via Soniox
        const transcript = await transcribeAudio(media);
        if (transcript) {
          parts.push({
            type: "text",
            text: `[Áudio transcrito]: ${transcript}`,
          });
        } else {
          parts.push({
            type: "text",
            text: `[Áudio recebido mas a transcrição falhou. Peça ao usuário para enviar novamente ou digitar a mensagem.]`,
          });
        }
      } else if (media.contentType === "application/pdf") {
        // PDFs → base64 data URL for Claude to analyze
        const dataUrl = await fetchMediaAsDataUrl(media);
        if (dataUrl) {
          parts.push({
            type: "file",
            mediaType: media.contentType,
            url: dataUrl,
          });
        }
      } else {
        // Video and others → placeholder
        parts.push({
          type: "text",
          text: `[Mídia recebida: ${media.contentType} — tipo não suportado para análise direta]`,
        });
      }
    }
  }

  // Skip if no content at all
  if (parts.length === 0) {
    return;
  }

  console.log(
    `[Twilio] Mensagem de ${message.ProfileName || userPhone}: ${userText || "(mídia)"} [${numMedia} mídia(s)]`,
  );

  // Build UIMessage array for the agent
  const uiMessages: UIMessage[] = [
    {
      id: message.MessageSid,
      role: "user",
      parts,
    },
  ];

  // Generate response using VoltAgent with UIMessage[]
  const response = await agent.generateText(uiMessages, {
    userId: userPhone,
    conversationId: `twilio_${userPhone}`,
  });

  // Send response back, splitting if needed
  if (response.text) {
    const chunks = splitMessage(response.text);
    for (const chunk of chunks) {
      await sendTwilioMessage(from, chunk);
    }
  }
}

// Handle incoming Twilio WhatsApp messages
export async function handleTwilioMessage(c: Context, agent: Agent) {
  try {
    // Parse Twilio form-urlencoded data
    const formData = await c.req.parseBody();
    const message = formData as unknown as TwilioIncomingMessage;

    // Fire-and-forget: process message in background so Twilio doesn't timeout.
    // Responses are sent via REST API, not TwiML, so we don't need to wait.
    processMessage(message, agent).catch((error) => {
      console.error("Error processing Twilio message:", error);
    });

    // Return empty TwiML immediately to avoid Twilio timeout
    return c.text("<Response></Response>", 200, {
      "Content-Type": "text/xml",
    });
  } catch (error) {
    console.error("Error parsing Twilio webhook:", error);
    return c.text("<Response></Response>", 200, {
      "Content-Type": "text/xml",
    });
  }
}

// Health/status check for Twilio webhook
export async function handleTwilioStatus(c: Context) {
  return c.json({ status: "ok", service: "twilio-whatsapp" });
}

export { sendTwilioMedia, sendTwilioMessage };
