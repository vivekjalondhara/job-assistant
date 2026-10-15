export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

// Hosting proxies can return plain text or HTML before an API handler runs.
export async function readJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new HttpError(
      response.status === 413
        ? "This upload is too large for this endpoint. Use Import CSV for files up to 50 MB."
        : response.status === 401
          ? "Please sign in again."
          : "The server could not complete this request. Please try again.",
      response.status,
    );
  }
  if (!response.ok) {
    const message = value && typeof value === "object" && "error" in value ? value.error : null;
    throw new HttpError(
      typeof message === "string" ? message : "The request failed. Please try again.",
      response.status,
    );
  }
  return value as T;
}
