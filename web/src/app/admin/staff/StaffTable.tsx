"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ErrorNote, FormError, Loading } from "@/components/States";
import { TopBar } from "@/components/ui";
import { adminNav } from "@/lib/adminNav";
import { api, ApiError, useApi, type Me } from "@/lib/api";
import { initials } from "@/lib/format";

type Member = {
  id: string;
  name: string;
  email: string;
  department: string;
  role: "admin" | "staff";
  status: "invited" | "active";
  wishCount: number;
  inDraw: boolean;
  hasSpun: boolean;
};

type ImportResult = { dryRun: boolean; toAdd: number; preview: { name: string; email: string; department: string }[]; skipped: { row: number; reason: string }[] };

function Status({ m }: { m: Member }) {
  if (m.status === "invited") return <span className="pill pill-grey">Not signed in</span>;
  if (m.hasSpun) return <span className="pill pill-green pill-dot">Spun</span>;
  if (m.inDraw) return <span className="pill pill-gold pill-dot">Ready to spin</span>;
  return <span className="pill pill-gold pill-dot">Signed in</span>;
}

export function StaffTable() {
  const { data: me } = useApi<Me>("/me");
  const { data, error, reload } = useApi<{ members: Member[] }>("/admin/members");
  const [q, setQ] = useState("");
  const addRef = useRef<HTMLDialogElement>(null);
  const csvRef = useRef<HTMLDialogElement>(null);
  const editRef = useRef<HTMLDialogElement>(null);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  const [editErr, setEditErr] = useState<string | null>(null);

  if (error?.status === 403) return <ErrorNote error="Only organisers can open this page." />;
  if (!me || !data) return <Loading />;

  const rows = data.members.filter((r) => `${r.name} ${r.email} ${r.department}`.toLowerCase().includes(q.trim().toLowerCase()));

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setAddErr(null);
    try {
      await api("/admin/members", { method: "POST", body: { name: f.get("name"), email: f.get("email"), department: f.get("dept") ?? "" } });
      form.reset();
      addRef.current?.close();
      reload();
    } catch (e) {
      setAddErr((e as ApiError).message);
    }
  }

  function openEdit(m: Member) {
    setEditing(m);
    setEditErr(null);
    editRef.current?.showModal();
  }

  async function saveEmail(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const f = new FormData(e.currentTarget);
    setEditErr(null);
    try {
      await api(`/admin/members/${editing.id}`, { method: "PATCH", body: { email: f.get("email") } });
      editRef.current?.close();
      setEditing(null);
      reload();
    } catch (err) {
      setEditErr((err as ApiError).message);
    }
  }

  async function remove(m: Member) {
    if (!window.confirm(`Remove ${m.name}? Their wishlist is deleted too.`)) return;
    setRowErr(null);
    try {
      await api(`/admin/members/${m.id}`, { method: "DELETE" });
      reload();
    } catch (e) {
      setRowErr((e as ApiError).message);
    }
  }

  return (
    <>
      <TopBar user={me.user.name} nav={[...adminNav("/admin/staff"), { href: "/home", label: "My spin" }]} />
      <div className="admin-head">
        <div>
          <span className="kicker">{me.current?.orgName} · Admin</span>
          <h1>Staff</h1>
          <p>Add people here, then share the sign-in link. They sign in with Google using the same email.</p>
        </div>
      </div>

      <section className="card">
        <div className="toolbar">
          <label className="search">
            <span className="sr-only">Search staff</span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input className="input" placeholder="Search name, email, team" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btn-ghost-ink btn-sm" onClick={() => csvRef.current?.showModal()}>
              Import CSV
            </button>
            <button className="btn btn-red btn-sm" onClick={() => addRef.current?.showModal()}>
              + Add person
            </button>
          </div>
        </div>
        <FormError message={rowErr} />

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Team</th>
                <th>Wishlist</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div className="person">
                      <span className="avatar">{initials(m.name)}</span>
                      <div>
                        <strong>
                          {m.name}
                          {m.role === "admin" && <span className="pill pill-grey" style={{ marginLeft: 8 }}>Admin</span>}
                        </strong>
                        <small>{m.email}</small>
                      </div>
                    </div>
                  </td>
                  <td>{m.department || <span className="card-muted">-</span>}</td>
                  <td>{m.wishCount ? `${m.wishCount} gift${m.wishCount > 1 ? "s" : ""}` : <span className="card-muted">None yet</span>}</td>
                  <td>
                    <Status m={m} />
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {m.role !== "admin" && m.status === "invited" && (
                      <button className="btn btn-ghost-ink btn-sm" style={{ marginRight: 8 }} onClick={() => openEdit(m)} aria-label={`Edit email for ${m.name}`}>
                        Edit email
                      </button>
                    )}
                    {m.role !== "admin" && (
                      <button className="btn btn-ghost-ink btn-sm" onClick={() => remove(m)} aria-label={`Remove ${m.name}`}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="card-muted" style={{ textAlign: "center", padding: 28 }}>
                    {q ? <>No one matches &ldquo;{q}&rdquo;.</> : "No one yet. Add your first teammate."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="card-muted" style={{ fontSize: "0.88rem", marginTop: 14 }}>
          {data.members.length} people · You can see who has spun, never who they got.
        </p>
      </section>

      <dialog ref={addRef} className="dialog" aria-labelledby="add-title">
        <form className="dialog-body" onSubmit={add}>
          <h2 id="add-title">Add a person</h2>
          <p className="card-muted" style={{ marginTop: 4 }}>
            They sign in with Google using this exact email.
          </p>
          <div className="form-grid" style={{ marginTop: 18 }}>
            <label className="lbl">
              Full name
              <input className="input" name="name" required maxLength={60} autoFocus />
            </label>
            <label className="lbl">
              Work email
              <input className="input" name="email" type="email" required maxLength={120} />
            </label>
            <label className="lbl">
              <span>
                Team <span className="hint">(optional)</span>
              </span>
              <input className="input" name="dept" maxLength={40} />
            </label>
            <FormError message={addErr} />
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost-ink btn-sm" onClick={() => addRef.current?.close()}>
              Cancel
            </button>
            <button type="submit" className="btn btn-red btn-sm">
              Add person
            </button>
          </div>
        </form>
      </dialog>

      <dialog ref={editRef} className="dialog" aria-labelledby="edit-title" onClose={() => setEditing(null)}>
        {/* key remounts the form per person so the field starts with their current email */}
        <form key={editing?.id ?? "none"} className="dialog-body" onSubmit={saveEmail}>
          <h2 id="edit-title">Edit email</h2>
          <p className="card-muted" style={{ marginTop: 4 }}>
            {editing ? <>For {editing.name}. </> : null}They haven&apos;t signed in yet. They must sign in with Google using this exact email.
          </p>
          <div className="form-grid" style={{ marginTop: 18 }}>
            <label className="lbl">
              Work email
              <input className="input" name="email" type="email" required maxLength={120} defaultValue={editing?.email ?? ""} autoFocus />
            </label>
            <FormError message={editErr} />
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost-ink btn-sm" onClick={() => editRef.current?.close()}>
              Cancel
            </button>
            <button type="submit" className="btn btn-red btn-sm">
              Save email
            </button>
          </div>
        </form>
      </dialog>

      <dialog ref={csvRef} className="dialog" aria-labelledby="csv-title">
        <CsvImport onClose={() => csvRef.current?.close()} onImported={reload} />
      </dialog>
    </>
  );
}

function CsvImport({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [csv, setCsv] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setErr(null);
    setPreview(null);
    if (!file) return;
    if (file.size > 1_000_000) return setErr("That file is over 1 MB.");
    const text = await file.text();
    setCsv(text);
    try {
      setPreview(await api<ImportResult>("/admin/members/import", { method: "POST", body: { csv: text, dryRun: true } }));
    } catch (e) {
      setErr((e as ApiError).message);
    }
  }

  async function confirm() {
    if (!csv) return;
    setBusy(true);
    try {
      await api("/admin/members/import", { method: "POST", body: { csv, dryRun: false } });
      onImported();
      setCsv(null);
      setPreview(null);
      onClose();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-body">
      <h2 id="csv-title">Import from CSV</h2>
      <p className="card-muted" style={{ marginTop: 4 }}>
        Columns: <code>name, email, team</code>. Up to 1,000 rows, 1 MB.
      </p>
      <label className="dropzone" style={{ marginTop: 18, cursor: "pointer" }}>
        <span style={{ fontSize: "1.8rem" }} aria-hidden="true">
          📄
        </span>
        <strong>Choose a .csv file</strong>
        <span>You&apos;ll see a preview before anything is saved.</span>
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={pick} />
      </label>
      <FormError message={err} />
      {preview && (
        <div style={{ marginTop: 14, fontSize: "0.92rem" }}>
          <p>
            <strong>{preview.toAdd}</strong> to add
            {preview.skipped.length > 0 && <>, {preview.skipped.length} skipped</>}.
          </p>
          {preview.skipped.slice(0, 5).map((s) => (
            <p key={s.row} className="card-muted">
              Row {s.row}: {s.reason}
            </p>
          ))}
        </div>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost-ink btn-sm" onClick={onClose}>
          Close
        </button>
        <button type="button" className="btn btn-red btn-sm" disabled={!preview?.toAdd || busy} onClick={confirm}>
          {busy ? "Importing…" : `Add ${preview?.toAdd ?? 0} people`}
        </button>
      </div>
    </div>
  );
}
