import { cn } from "cn";
import { CircleAlert, CircleCheck, X } from "lucide-react";
import { Toast as ToastPrimitive } from "radix-ui";
import { createContext, type ReactNode, useContext, useState } from "react";
import { Button } from "@/components/ui/button";

type ToastKind = "success" | "error";
type Notify = (kind: ToastKind, message: string) => void;

const ToastContext = createContext<Notify | null>(null);

function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; kind: ToastKind; message: string } | null>(null);
  const success = toast?.kind === "success";
  const Icon = success ? CircleCheck : CircleAlert;

  function notify(kind: ToastKind, message: string) {
    setToast((previous) => ({ id: (previous?.id ?? 0) + 1, kind, message }));
  }

  return (
    <ToastContext.Provider value={notify}>
      <ToastPrimitive.Provider label="Notification" duration={5000}>
        {children}
        {toast && (
          <ToastPrimitive.Root
            key={toast.id}
            open
            onOpenChange={(open) => {
              if (!open) setToast((current) => (current?.id === toast.id ? null : current));
            }}
            className="pointer-events-auto flex items-center gap-3 rounded-xl border border-border bg-popover py-2 pr-2 pl-3 text-sm text-popover-foreground shadow-lg shadow-foreground/10 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-200 dark:shadow-black/30"
          >
            <span
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-lg",
                success ? "bg-success/15 text-success-foreground" : "bg-destructive/10 text-destructive",
              )}
            >
              <Icon aria-hidden="true" className="size-4" />
            </span>
            <ToastPrimitive.Title className="min-w-0 flex-1 font-medium leading-5 wrap-break-word">
              {toast.message}
            </ToastPrimitive.Title>
            <ToastPrimitive.Close asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Fermer la notification"
                className="text-muted-foreground pointer-coarse:size-11"
              >
                <X aria-hidden="true" />
              </Button>
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        )}
        <ToastPrimitive.Viewport
          label="Notifications ({hotkey})"
          className="pointer-events-none fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[100] mx-auto flex max-w-sm flex-col outline-none"
        />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

function useToast() {
  const notify = useContext(ToastContext);
  if (!notify) throw new Error("useToast requires ToastProvider.");
  return notify;
}

export { ToastProvider, useToast };
