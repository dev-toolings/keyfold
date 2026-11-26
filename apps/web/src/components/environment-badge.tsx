import { Badge, type BadgeProps } from "@/components/reui/badge";
import { ENVIRONMENT_LABELS } from "@/lib/classification";
import type { Environment } from "@/vault";

const variants = {
  prod: "destructive-light",
  preprod: "warning-light",
  local: "secondary",
} as const;

export function EnvironmentBadge({ environment, size }: { environment: Environment; size?: BadgeProps["size"] }) {
  return (
    <Badge
      variant={variants[environment]}
      size={size}
      className={environment === "local" ? "bg-muted text-muted-foreground" : undefined}
    >
      {ENVIRONMENT_LABELS[environment]}
    </Badge>
  );
}
