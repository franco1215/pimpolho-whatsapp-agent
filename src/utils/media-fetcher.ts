import type { TwilioIncomingMessage, TwilioMedia } from "../types/twilio";

const MAX_MEDIA_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Extract media entries from Twilio webhook form data.
 * Twilio sends MediaUrl{N} and MediaContentType{N} for each attachment.
 */
export function extractMedia(
  message: TwilioIncomingMessage,
  numMedia: number,
): TwilioMedia[] {
  const media: TwilioMedia[] = [];

  for (let i = 0; i < numMedia; i++) {
    const msg = message as unknown as Record<string, string>;
    const url = msg[`MediaUrl${i}`];
    const contentType = msg[`MediaContentType${i}`];
    if (url && contentType) {
      media.push({ url, contentType });
    }
  }

  return media;
}

/**
 * Fetch a Twilio media file and convert to data URL (base64).
 * Uses Basic Auth with Twilio SID:TOKEN to access media.
 */
export async function fetchMediaAsDataUrl(
  media: TwilioMedia,
): Promise<string | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const token = process.env.TWILIO_AUTH_TOKEN || "";

  try {
    const response = await fetch(media.url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch media: ${response.status} ${response.statusText}`);
      return null;
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_MEDIA_SIZE) {
      console.warn(`Media too large (${contentLength} bytes), skipping`);
      return null;
    }

    const buffer = await response.arrayBuffer();

    if (buffer.byteLength > MAX_MEDIA_SIZE) {
      console.warn(`Media too large (${buffer.byteLength} bytes), skipping`);
      return null;
    }

    const base64 = Buffer.from(buffer).toString("base64");
    return `data:${media.contentType};base64,${base64}`;
  } catch (error) {
    console.error("Error fetching media:", error);
    return null;
  }
}
