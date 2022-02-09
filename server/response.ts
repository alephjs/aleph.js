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
  contentType: string,
  cacheContorl?: CacheControl | "immutable" | "no-cache",
): Response {
  let cc: any;
  if (cacheContorl) {
    if (cacheContorl === "no-cache") {
      cc = "no-chche";
    } else if (cacheContorl === "immutable") {
      cc = "public, max-age=31536000, immutable";
    } else {
      const { maxAge, sMaxAge, immutable, mustRevalidate } = cacheContorl;
      cc = [
        cacheContorl.public && "public",
        cacheContorl.private && "private",
        maxAge && `max-age=${maxAge}`,
        sMaxAge && `s-maxage=${sMaxAge}`,
        immutable && "immutable",
        mustRevalidate && "must-revalidate",
      ].filter(Boolean).join(", ");
    }
  }
  return new Response(content, {
    headers: {
      "content-type": contentType,
      "cache-control": cc,
    },
  });
}
