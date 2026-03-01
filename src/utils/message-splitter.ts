const DEFAULT_MAX_LENGTH = 4000; // WhatsApp limit is 4096, leave some margin

/**
 * Split a long message into chunks that fit within WhatsApp's character limit.
 * Tries to split at paragraph boundaries, then sentence boundaries, then word boundaries.
 */
export function splitMessage(
  text: string,
  maxLength: number = DEFAULT_MAX_LENGTH,
): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at paragraph boundary
    let splitIndex = remaining.lastIndexOf("\n\n", maxLength);

    // Try sentence boundary
    if (splitIndex <= 0) {
      splitIndex = remaining.lastIndexOf(". ", maxLength);
      if (splitIndex > 0) splitIndex += 1; // Include the period
    }

    // Try newline
    if (splitIndex <= 0) {
      splitIndex = remaining.lastIndexOf("\n", maxLength);
    }

    // Try word boundary
    if (splitIndex <= 0) {
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }

    // Force split if no good boundary found
    if (splitIndex <= 0) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex).trimEnd());
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks.filter((chunk) => chunk.length > 0);
}
