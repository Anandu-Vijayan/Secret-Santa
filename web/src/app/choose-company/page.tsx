"use client";

import { Loading, ErrorNote } from "@/components/States";
import { Snow, TopBar } from "@/components/ui";
import { api, ApiError, useApi, type Me } from "@/lib/api";
import { useState } from "react";

export default function ChooseCompany() {
  const { data: me } = useApi<Me>("/me");
  const [err, setErr] = useState<string | null>(null);

  async function choose(orgId: string, role: string) {
    try {
      await api("/me/org", { method: "POST", body: { orgId } });
      window.location.assign(role === "admin" ? "/admin" : "/home");
    } catch (e) {
      setErr((e as ApiError).message);
    }
  }

  return (
    <>
      <Snow />
      <main className="page page-narrow">
        <TopBar user={me?.user.name} />
        {!me ? (
          <Loading />
        ) : (
          <div className="auth">
            <div className="card">
              <span className="kicker">You&apos;re in more than one</span>
              <h1>Pick a company</h1>
              <div className="form-grid" style={{ marginTop: 22 }}>
                {me.orgs.map((o) => (
                  <button key={o.orgId} className="btn btn-ghost-ink" onClick={() => choose(o.orgId, o.role)}>
                    {o.orgName} {o.role === "admin" && "· Admin"}
                  </button>
                ))}
              </div>
              <ErrorNote error={err} />
            </div>
          </div>
        )}
      </main>
    </>
  );
}
