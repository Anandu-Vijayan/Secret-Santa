import type { ApiError } from "@/lib/api";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="muted" role="status" style={{ padding: "48px 0", textAlign: "center" }}>
      {label}
    </p>
  );
}

export function ErrorNote({ error }: { error: ApiError | Error | string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="error" style={{ marginInline: "auto" }}>
      {typeof error === "string" ? error : error.message}
    </p>
  );
}

/** Inline error on paper cards. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" style={{ color: "var(--cranberry)", fontWeight: 600, fontSize: "0.92rem" }}>
      {message}
    </p>
  );
}
