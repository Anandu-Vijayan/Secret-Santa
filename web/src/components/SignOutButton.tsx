"use client";

import { signOut } from "@/lib/api";

export function SignOutButton() {
  return (
    <button type="button" className="link-btn" onClick={signOut} style={{ marginLeft: 6 }}>
      Sign out
    </button>
  );
}
