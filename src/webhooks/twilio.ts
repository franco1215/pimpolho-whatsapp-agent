import type { Agent } from "@voltagent/core";
import type { Context } from "hono";
import Twilio from "twilio";
import type { TwilioIncomingMessage } from "../types/twilio";

const twilioClient = Twilio(
  process.env.TWILIO_ACCOUNT_SID || "",
  process.env.TWILIO_AUTH_TOKEN || "",
);

// Extract phone number from Twilio's "whatsapp:+55..." format
function extractPhone(twilioFrom: string): string {
  return twilioFrom.replace("whatsapp:", "");
}

// Send message back via Twilio WhatsApp
async function sendTwilioMessage(to: string, body: string): Promise<boolean> {
  try {
    const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || "";
    await twilioClient.messages.create({
      from: `whatsapp:${fromNumber}`,
      to: to, // already in "whatsapp:+55..." format
      body: body,
    });
    return true;
  } catch (error) {
    console.error("Failed to send Twilio message:", error);
    return false;
  }
}

// Handle incoming Twilio WhatsApp messages
export async function handleTwilioMessage(c: Context, agent: Agent) {
  try {
    // Twilio sends form-urlencoded data
    const formData = await c.req.parseBody();
    const message = formData as unknown as TwilioIncomingMessage;

    const userPhone = extractPhone(message.From);
    const userMessage = message.Body?.trim();

    if (!userMessage) {
      return c.text("<Response></Response>", 200, {
        "Content-Type": "text/xml",
      });
    }

    console.log(
      `[Twilio] Mensagem de ${message.ProfileName || userPhone}: ${userMessage}`,
    );

    // Generate response using VoltAgent
    const response = await agent.generateText(userMessage, {
      userId: userPhone,
      conversationId: `twilio_${userPhone}`,
    });

    // Send response back via Twilio
    if (response.text) {
      await sendTwilioMessage(message.From, response.text);
    }

    // Return empty TwiML (we send response async via API)
    return c.text("<Response></Response>", 200, {
      "Content-Type": "text/xml",
    });
  } catch (error) {
    console.error("Error processing Twilio webhook:", error);
    return c.text("<Response></Response>", 200, {
      "Content-Type": "text/xml",
    });
  }
}

// Health/status check for Twilio webhook
export async function handleTwilioStatus(c: Context) {
  return c.json({ status: "ok", service: "twilio-whatsapp" });
}
