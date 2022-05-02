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
    let status = res.status;
    let message = res.statusText;
    let details: Record<string, unknown> = {};
    if (status >= 300 && status < 400) {
      const location = res.headers.get("Location");
      if (location) {
        details.location = location;
      }
    }
    if (res.headers.get("content-type")?.startsWith("application/json")) {
      const data = await res.json();
      if (typeof data.status === "number") {
        status = data.status;
      }
      if (typeof data.message === "string") {
        message = data.message;
      }
      if (typeof data.details === "object" && data.details !== null) {
        details = data.details;
      }
    } else {
      message = await res.text();
    }
    return new FetchError(status, details, message);
  }
}
