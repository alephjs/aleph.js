export default class FetchError extends Error {
  constructor(
    public status: number,
    public details: Record<string, unknown>,
    message: string,
    opts?: ErrorOptions,
  ) {
    super(message, opts);
  }

  static async fromResponse(res: Response): Promise<FetchError> {
    let message = res.statusText;
    let details: Record<string, unknown> = {};
    if (res.headers.get("content-type")?.startsWith("application/json")) {
      details = await res.json();
      if (typeof details.message === "string") {
        message = details.message;
      }
    } else {
      message = await res.text();
    }
    return new FetchError(res.status, details, message);
  }
}
