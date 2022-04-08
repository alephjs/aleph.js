export function json(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.append("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}

export type CacheControl = {
  maxAge?: number;
  sMaxAge?: number;
  public?: boolean;
  private?: boolean;
  immutable?: boolean;
  mustRevalidate?: boolean;
};

export function content(
  content: BodyInit,
  init?: ResponseInit & {
    contentType?: string;
    cacheContorl?: CacheControl | "immutable" | "no-cache";
  },
): Response {
  const headers = new Headers(init?.headers);

  const contentType = init?.contentType;
  if (contentType) {
    headers.set("Content-Type", contentType);
  }

  const cacheContorl = init?.cacheContorl;
  if (cacheContorl) {
    if (cacheContorl === "no-cache") {
      headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
    } else if (cacheContorl === "immutable") {
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      const { maxAge, sMaxAge, immutable, mustRevalidate } = cacheContorl;
      headers.set(
        "Cache-Control",
        [
          cacheContorl.public && "public",
          cacheContorl.private && "private",
          maxAge && `max-age=${maxAge}`,
          sMaxAge && `s-maxage=${sMaxAge}`,
          immutable && "immutable",
          mustRevalidate && "must-revalidate",
        ].filter(Boolean).join(", "),
      );
    }
  }

  return new Response(content, { ...init, headers });
}
