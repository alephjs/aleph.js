export const encoder = new TextEncoder();
export const decoder = new TextDecoder();

export function toHex(buf: ArrayBuffer) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** compute hash of the content */
export async function computeHash(
  algorithm: AlgorithmIdentifier,
  content: string | Uint8Array,
): Promise<string> {
  const buf = await crypto.subtle.digest(
    algorithm,
    typeof content === "string" ? encoder.encode(content) : content,
  );
  return toHex(buf);
}
