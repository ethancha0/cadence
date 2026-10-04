import Link from "next/link";
import type { ReactNode } from "react";
import { supabaseConfigured } from "@/lib/supabase/client";

export function AuthShell({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <>
      <nav className="nav">
        <Link href="/" className="nav-brand">
          Cadence
        </Link>
      </nav>
      <main className="main">
        <div className="auth">
          <header style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <h1 className="page-title" style={{ fontSize: 44 }}>
              {title}
            </h1>
            {sub && <p className="text-muted small" style={{ margin: 0 }}>{sub}</p>}
          </header>
          {supabaseConfigured ? (
            children
          ) : (
            <p className="small">
              Sign-in is off in local demo mode. <Link href="/">Open Cadence</Link>
            </p>
          )}
        </div>
      </main>
    </>
  );
}
