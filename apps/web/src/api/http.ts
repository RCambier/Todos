/** Thrown when a Google API call fails; carries the HTTP status for callers that care. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** A plain `fetch` wrapper that adds the bearer token and surfaces Google's error body. */
export async function authedFetch(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // response body wasn't JSON; keep the status text
    }
    throw new ApiError(res.status, message);
  }
  return res;
}

export async function authedJson<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await authedFetch(token, url, init);
  return (await res.json()) as T;
}
