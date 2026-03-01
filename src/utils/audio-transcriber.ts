import type { TwilioMedia } from "../types/twilio";

const SONIOX_BASE_URL = "https://api.soniox.com/v1";
const POLL_INTERVAL_MS = 1_000;
const POLL_TIMEOUT_MS = 60_000;

/**
 * Download media from Twilio (requires Basic Auth) and return as Buffer.
 */
async function fetchMediaAsBuffer(media: TwilioMedia): Promise<Buffer> {
  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const token = process.env.TWILIO_AUTH_TOKEN || "";

  const response = await fetch(media.url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch media: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer);
}

/**
 * Upload audio buffer to Soniox Files API.
 * Returns the file ID.
 */
async function uploadToSoniox(buffer: Buffer, filename: string): Promise<string> {
  const apiKey = process.env.SONIOX_API_KEY!;

  const formData = new FormData();
  formData.append("file", new Blob([new Uint8Array(buffer)]), filename);

  const response = await fetch(`${SONIOX_BASE_URL}/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Soniox upload failed: ${response.status} — ${body}`);
  }

  const data = (await response.json()) as { id: string };
  return data.id;
}

/**
 * Create a transcription job on Soniox for the given file.
 * Returns the transcription ID.
 */
async function createTranscription(fileId: string): Promise<string> {
  const apiKey = process.env.SONIOX_API_KEY!;

  const response = await fetch(`${SONIOX_BASE_URL}/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      file_id: fileId,
      model: "stt-async-v4",
      language_hints: ["pt"],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Soniox transcription creation failed: ${response.status} — ${body}`);
  }

  const data = (await response.json()) as { id: string };
  return data.id;
}

/**
 * Poll Soniox until the transcription is completed or failed.
 */
async function pollTranscriptionStatus(transcriptionId: string): Promise<void> {
  const apiKey = process.env.SONIOX_API_KEY!;
  const start = Date.now();

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const response = await fetch(`${SONIOX_BASE_URL}/transcriptions/${transcriptionId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      throw new Error(`Soniox poll failed: ${response.status}`);
    }

    const data = (await response.json()) as { status: string };

    if (data.status === "completed") {
      return;
    }

    if (data.status === "error" || data.status === "failed") {
      throw new Error(`Soniox transcription failed with status: ${data.status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error("Soniox transcription timed out after 60s");
}

/**
 * Retrieve the transcript text from a completed transcription.
 */
async function getTranscript(transcriptionId: string): Promise<string> {
  const apiKey = process.env.SONIOX_API_KEY!;

  const response = await fetch(`${SONIOX_BASE_URL}/transcriptions/${transcriptionId}/transcript`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Soniox transcript fetch failed: ${response.status} — ${body}`);
  }

  const data = (await response.json()) as { text: string };
  return data.text;
}

/**
 * Transcribe an audio message from Twilio using Soniox.
 *
 * Flow: Download from Twilio → Upload to Soniox → Create transcription → Poll → Get text
 *
 * Returns the transcribed text, or null if transcription is unavailable or fails.
 */
export async function transcribeAudio(media: TwilioMedia): Promise<string | null> {
  if (!process.env.SONIOX_API_KEY) {
    console.warn("[Soniox] SONIOX_API_KEY not configured, skipping audio transcription");
    return null;
  }

  try {
    console.log("[Soniox] Downloading audio from Twilio...");
    const buffer = await fetchMediaAsBuffer(media);

    const extension = media.contentType.split("/")[1] || "ogg";
    const filename = `audio.${extension}`;

    console.log(`[Soniox] Uploading ${filename} (${buffer.length} bytes)...`);
    const fileId = await uploadToSoniox(buffer, filename);

    console.log(`[Soniox] Creating transcription for file ${fileId}...`);
    const transcriptionId = await createTranscription(fileId);

    console.log(`[Soniox] Polling transcription ${transcriptionId}...`);
    await pollTranscriptionStatus(transcriptionId);

    console.log("[Soniox] Fetching transcript...");
    const text = await getTranscript(transcriptionId);

    console.log(`[Soniox] Transcription complete: "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"`);
    return text;
  } catch (error) {
    console.error("[Soniox] Audio transcription failed:", error);
    return null;
  }
}
