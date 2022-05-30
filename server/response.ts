export type CacheControlOptions = {
  maxAge?: number;
  sMaxAge?: number;
  public?: boolean;
  private?: boolean;
  immutable?: boolean;
  mustRevalidate?: boolean;
};

export function content(
  body: BodyInit,
  init?: ResponseInit & {
    contentType?: string;
    cacheControl?: CacheControlOptions | "immutable" | "no-cache";
  },
): Response {
  const headers = new Headers(init?.headers);

  const contentType = init?.contentType;
  if (contentType) {
    headers.set("Content-Type", contentType);
  }

  const cacheControl = init?.cacheControl;
  if (cacheControl) {
    if (cacheControl === "no-cache") {
      headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
    } else if (cacheControl === "immutable") {
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      const { maxAge, sMaxAge, immutable, mustRevalidate } = cacheControl;
      headers.set(
        "Cache-Control",
        [
          cacheControl.public && "public",
          cacheControl.private && "private",
          maxAge && `max-age=${maxAge}`,
          sMaxAge && `s-maxage=${sMaxAge}`,
          immutable && "immutable",
          mustRevalidate && "must-revalidate",
        ].filter(Boolean).join(", "),
      );
    }
  }

  return new Response(body, { ...init, headers });
}

export function json(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.append("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export type CookieOptions = {
  expires?: number | Date;
  maxAge?: number;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
};

export function setCookieHeader(name: string, value: string, options?: CookieOptions): string {
  const cookie = [`${name}=${value}`];
  if (options) {
    if (options.expires) {
      cookie.push(`Expires=${new Date(options.expires).toUTCString()}`);
    }
    if (options.maxAge) {
      cookie.push(`Max-Age=${options.maxAge}`);
    }
    if (options.domain) {
      cookie.push(`Domain=${options.domain}`);
    }
    if (options.path) {
      cookie.push(`Path=${options.path}`);
    }
    if (options.httpOnly) {
      cookie.push("HttpOnly");
    }
    if (options.secure) {
      cookie.push("Secure");
    }
    if (options.sameSite) {
      cookie.push(`SameSite=${options.sameSite}`);
    }
  }
  return cookie.join("; ");
}

export function fixResponse(res: Response, addtionHeaders: Headers, fixRedirect: boolean): Response {
  if (res.status >= 300 && res.status < 400 && fixRedirect) {
    return json({ redirect: { location: res.headers.get("Location"), status: res.status } }, {
      status: 501,
      headers: addtionHeaders,
    });
  }
  let headers: Headers | null = null;
  addtionHeaders.forEach((value, name) => {
    if (!headers) {
      headers = new Headers(res.headers);
    }
    headers.set(name, value);
  });
  if (headers) {
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
  return res;
}
