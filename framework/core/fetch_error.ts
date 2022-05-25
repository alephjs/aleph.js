export default class FetchError extends Error {
  public status: number;
  public details: Record<string, unknown>;

  constructor(
    status: number,
    message: string,
    details?: Record<string, unknown>,
    opts?: ErrorOptions,
  ) {
    super(message, opts);
    this.status = status;
    this.details = details ?? {};
  }

  static async fromResponse(res: Response): Promise<FetchError> {
    let status = res.status;
    let message = (await res.text());
    const details: Record<string, unknown> = {};
    if (message.startsWith("{") && message.endsWith("}")) {
      try {
        const data = JSON.parse(message);
        const { status: maybeStatus, message: maybeMessage, details: maybeDetail, ...rest } = data;
        if (typeof maybeStatus === "number") {
          status = maybeStatus;
        }
        if (typeof maybeMessage === "string") {
          message = maybeMessage;
        }
        if (maybeDetail !== null && typeof maybeDetail === "object" && !Array.isArray(maybeDetail)) {
          Object.assign(details, maybeDetail);
        }
        Object.assign(details, rest);
      } catch (_e) {
        // ignore
      }
    }
    return new FetchError(status, message, details);
  }
}
