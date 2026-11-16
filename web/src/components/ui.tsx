import Link from "next/link";
import { initials } from "@/lib/format";
import { SignOutButton } from "./SignOutButton";

/** Deterministic snowflakes so server and client render the same markup. */
export function Snow({ count = 36 }: { count?: number }) {
  const flakes = Array.from({ length: count }, (_, i) => {
    const r = (n: number) => ((i * 9301 + n * 49297) % 233280) / 233280;
    return {
      left: `${(r(1) * 100).toFixed(2)}%`,
      ["--s" as string]: `${(3 + r(2) * 6).toFixed(1)}px`,
      ["--o" as string]: (0.25 + r(3) * 0.55).toFixed(2),
      ["--d" as string]: `${(10 + r(4) * 14).toFixed(1)}s`,
      ["--delay" as string]: `${(-r(5) * 24).toFixed(1)}s`,
      ["--drift" as string]: `${(-40 + r(6) * 80).toFixed(0)}px`,
    };
  });
  return (
    <div className="snow" aria-hidden="true">
      {flakes.map((style, i) => (
        <i key={i} style={style} />
      ))}
    </div>
  );
}

export function GiftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5" />
    </svg>
  );
}

export function Brand() {
  return (
    <Link href="/" className="brand">
      <span className="brand-mark">
        <GiftIcon />
      </span>
      Secret Santa
    </Link>
  );
}

type NavItem = { href: string; label: string; current?: boolean; hideSm?: boolean };

export function TopBar({ nav = [], user }: { nav?: NavItem[]; user?: string }) {
  return (
    <header className="topbar">
      <Brand />
      <nav className="nav" aria-label="Main">
        {nav.map((n) => (
          <Link key={n.href} href={n.href} aria-current={n.current ? "page" : undefined} className={n.hideSm ? "hide-sm" : undefined}>
            {n.label}
          </Link>
        ))}
        {user && (
          <>
            <span className="avatar" title={user} aria-label={`Signed in as ${user}`}>
              {initials(user)}
            </span>
            <SignOutButton />
          </>
        )}
      </nav>
    </header>
  );
}

export function GoogleButton({ href, label = "Continue with Google", wide }: { href: string; label?: string; wide?: boolean }) {
  // /api/* are route handlers, not pages. A <Link> would prefetch them: the sign-in start route sets a
  // one-time state cookie, so a prefetch could overwrite the one the real click is using.
  const Tag = href.startsWith("/api/") ? "a" : Link;
  return (
    <Tag href={href} className={`gbtn${wide ? " gbtn-wide" : ""}`}>
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
      {label}
    </Tag>
  );
}

export function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}
