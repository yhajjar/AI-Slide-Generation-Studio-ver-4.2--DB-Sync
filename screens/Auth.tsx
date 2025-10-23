// screens/Auth.tsx
import React, { useState } from "react";
import { login as apiLogin } from "../auth";

const box: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  padding: 20,
  background: "rgba(255,255,255,0.85)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.05)",
};

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...rest } = props;
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: "#475569", marginBottom: 6 }}>{label}</div>
      <input
        {...rest}
        style={{
          width: "100%",
          border: "1px solid #cbd5e1",
          borderRadius: 12,
          padding: "10px 12px",
          fontSize: 14,
          outline: "none",
        }}
      />
    </label>
  );
}

export function LoginView({ onSuccess }: { onSuccess: () => void; }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await apiLogin(email, password);
      onSuccess();
    } catch (e: any) {
      setErr(e.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#f8fafc,#eef2ff)", display: "grid", placeItems: "center", padding: 24 }}>
      <form onSubmit={submit} style={{ ...box, width: 420, maxWidth: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div style={{ color: "#0369a1", fontWeight: 700 }}>✨</div>
          <div style={{ fontWeight: 600 }}>AI Slide Generation Studio</div>
        </div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>Welcome back — sign in to continue</div>

        <TextInput label="Email" type="email" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
        <TextInput label="Password" type="password" required value={password} onChange={(e) => setPassword(e.currentTarget.value)} />

        {err && <div style={{ color: "#b91c1c", background: "#fee2e2", border: "1px solid #fecaca", borderRadius: 8, padding: 8, fontSize: 12, marginBottom: 8 }}>{err}</div>}

        <button
          type="submit"
          disabled={busy}
          style={{
            width: "100%",
            borderRadius: 12,
            padding: "10px 12px",
            background: busy ? "#7dd3fc" : "#0284c7",
            color: "white",
            fontWeight: 600,
            border: "none",
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}