"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "@/lib/store";

export function Nav() {
  const { live, catName } = useStore();
  const path = usePathname();
  const current = (href: string, also: string[] = []) =>
    path === href || also.some((p) => path.startsWith(p)) ? "page" : undefined;

  return (
    <nav className="nav">
      <Link href="/" className="nav-brand">
        Cadence
      </Link>
      <div className="nav-links">
        <Link className="btn btn-ghost" href={live ? "/session" : "/"} aria-current={current("/", ["/session", "/summary"])}>
          Session
        </Link>
        {live && <span className="tag tag-accent">Live · {catName(live.block.category_id)}</span>}
        <Link className="btn btn-ghost" href="/tasks" aria-current={current("/tasks")}>
          Tasks
        </Link>
        <Link className="btn btn-ghost" href="/history" aria-current={current("/history")}>
          Notes &amp; history
        </Link>
        <Link className="btn btn-ghost" href="/settings" aria-current={current("/settings")}>
          Settings
        </Link>
      </div>
    </nav>
  );
}
