"use client";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:7100";

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      ...(opts.body !== undefined
        ? { "content-type": "application/json" }
        : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}
