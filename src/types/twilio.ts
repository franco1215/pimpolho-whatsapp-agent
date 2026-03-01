export interface TwilioIncomingMessage {
  MessageSid: string;
  AccountSid: string;
  From: string; // "whatsapp:+5511999999999"
  To: string; // "whatsapp:+5511888888888"
  Body: string;
  NumMedia: string;
  ProfileName?: string;
  WaId?: string; // WhatsApp phone number without prefix

  // Media attachments (up to 10)
  MediaUrl0?: string;
  MediaContentType0?: string;
  MediaUrl1?: string;
  MediaContentType1?: string;
  MediaUrl2?: string;
  MediaContentType2?: string;
  MediaUrl3?: string;
  MediaContentType3?: string;
  MediaUrl4?: string;
  MediaContentType4?: string;
  MediaUrl5?: string;
  MediaContentType5?: string;
  MediaUrl6?: string;
  MediaContentType6?: string;
  MediaUrl7?: string;
  MediaContentType7?: string;
  MediaUrl8?: string;
  MediaContentType8?: string;
  MediaUrl9?: string;
  MediaContentType9?: string;

  // Location sharing
  Latitude?: string;
  Longitude?: string;

  // Interactive buttons
  ButtonText?: string;
  ButtonPayload?: string;
}

export interface TwilioMedia {
  url: string;
  contentType: string;
}
