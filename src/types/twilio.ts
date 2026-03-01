export interface TwilioIncomingMessage {
  MessageSid: string;
  AccountSid: string;
  From: string; // "whatsapp:+5511999999999"
  To: string; // "whatsapp:+5511888888888"
  Body: string;
  NumMedia: string;
  ProfileName?: string;
  WaId?: string; // WhatsApp phone number without prefix
}
