import { cn } from "cn";
import { Eye, EyeOff } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PasswordInputProps = Omit<ComponentProps<typeof Input>, "type"> & {
  id: string;
  label: string;
  variant?: "default" | "compact";
};

export function PasswordInput({ id, label, disabled, className, variant = "default", ...props }: PasswordInputProps) {
  const [shown, setShown] = useState(false);
  const Icon = shown ? EyeOff : Eye;
  const compact = variant === "compact";

  return (
    <div className="relative">
      <Input
        id={id}
        type={shown ? "text" : "password"}
        disabled={disabled}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cn(
          compact ? "pr-9 font-mono" : "h-11 pr-12 md:not-pointer-coarse:h-8 md:not-pointer-coarse:pr-9",
          className,
        )}
        {...props}
      />
      <Button
        type="button"
        variant="ghost"
        size={compact ? "icon-xs" : "icon-sm"}
        disabled={disabled}
        aria-label={`${shown ? "Masquer" : "Afficher"} ${label}`}
        aria-controls={id}
        onClick={() => setShown((visible) => !visible)}
        className={
          compact
            ? "absolute top-1/2 right-1.5 -translate-y-1/2"
            : "absolute inset-y-0 right-0.5 my-auto size-11 text-muted-foreground transition-colors md:not-pointer-coarse:right-1 md:not-pointer-coarse:size-7"
        }
      >
        <Icon aria-hidden="true" />
      </Button>
    </div>
  );
}
