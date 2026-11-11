// Owner: pages worker. Stub: will port LpButton from apps/web/src/pages/landing.tsx.
import type { ReactNode } from "react";

export function LpButton({
  to,
  variant,
  size = "lg",
  children,
}: {
  to: string;
  variant: "primary" | "ghost";
  size?: "sm" | "lg";
  children: ReactNode;
}) {
  return (
    <a href={to} className={`lp-btn lp-btn-${variant} lp-btn-${size}`}>
      {children}
    </a>
  );
}
