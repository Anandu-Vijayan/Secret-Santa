"use client";

import { useCallback, useEffect, useState } from "react";

export type Wish = { id?: string; title: string; price?: string | null; link?: string | null; note?: string | null };

export type Me = {
  user: { name: string; email: string };
  orgs: { orgId: string; orgName: string; role: "admin" | "staff" }[];
  current: null | {
    orgId: string;
    orgName: string;
    role: "admin" | "staff";
    name: string;
    department: string;
    wishCount: number;
  };
  event?: null | {
    name: string;
    budget: string;
    exchangeDate: string | null;
    status: "draft" | "open" | "closed";
    participant: boolean;
    revealed: boolean;
  };
};

export type Reveal = {
  giftee: { name: string; department: string; wishes: Wish[] };
  wheel: { names: string[]; targetIndex: number };
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Same-origin JSON call to the API through the /api proxy. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "error", data.message ?? "Something went wrong.");
  return data as T;
}

/** Load data on mount. Sends signed-out users to /login. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!path) return;
    let live = true;
    api<T>(path)
      .then((d) => live && (setData(d), setError(null)))
      .catch((e: ApiError) => {
        if (!live) return;
        if (e.status === 401) window.location.assign("/login");
        else if (e.code === "no_company") window.location.assign("/choose-company");
        else setError(e);
      });
    return () => {
      live = false;
    };
  }, [path, tick]);

  return { data, error, reload };
}

export async function signOut() {
  await api("/auth/logout", { method: "POST", body: {} }).catch(() => {});
  window.location.assign("/");
}
