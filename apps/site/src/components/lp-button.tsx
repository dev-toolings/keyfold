import { ArrowUpRight, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * The only button of the page. Same action, same look everywhere:
 * primary is the app's own Button (36 px or 50 px); ghost leads anywhere else.
 * The icon is set by the variant.
 */
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
  // The public site has no vault: a link into it is dropped.
  if (to.startsWith("/personal")) return null;
  const content = (
    <>
      {children}
      {variant === "primary" ? <ArrowUpRight /> : <ChevronRight />}
    </>
  );
  if (variant === "primary") {
    return (
      <Button asChild size={size === "sm" ? "lg" : "xl"}>
        {to.startsWith("https://") ? (
          <a href={to} target="_blank" rel="noopener noreferrer">
            {content}
          </a>
        ) : (
          <a href={to}>{content}</a>
        )}
      </Button>
    );
  }
  return (
    <a href={to} className={`lp-btn lp-btn-ghost lp-btn-${size}`}>
      {content}
    </a>
  );
}
