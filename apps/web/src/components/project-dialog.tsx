import { LoaderCircle } from "lucide-react";
import { type FormEvent, type ReactElement, useRef, useState } from "react";
import { ClassificationListField } from "@/components/classification-list-field";
import { ProgrammingLanguageField } from "@/components/programming-language-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { distinctLabels } from "@/lib/classification";
import { errorMessage } from "@/lib/labels";

type ProjectDraft = { name: string; specialty: string; languages: string[]; tags: string[] };

export function ProjectDialog({
  trigger,
  onCreate,
}: {
  trigger: ReactElement;
  onCreate: (draft: ProjectDraft) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const saving = useRef(false);
  return (
    <Dialog open={open} onOpenChange={(next) => !saving.current && setOpen(next)}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className="w-[calc(100%-2rem)] sm:max-w-lg"
        onEscapeKeyDown={(e) => saving.current && e.preventDefault()}
      >
        <ProjectForm
          onCancel={() => setOpen(false)}
          onCreate={onCreate}
          onSaving={(value) => {
            saving.current = value;
          }}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ProjectForm({
  onCancel,
  onCreate,
  onSaving,
  onDone,
}: {
  onCancel: () => void;
  onCreate: (draft: ProjectDraft) => Promise<void>;
  onSaving: (value: boolean) => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<ProjectDraft>({ name: "", specialty: "", languages: [], tags: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A project dialog can be opened from the item form across a React portal.
    event.stopPropagation();
    if (busy) return;
    const name = draft.name.trim();
    if (!name) {
      setNameError("Saisissez le nom du projet.");
      nameInput.current?.focus();
      return;
    }
    setError("");
    setBusy(true);
    onSaving(true);
    try {
      await onCreate({
        name,
        specialty: draft.specialty.trim(),
        languages: distinctLabels(draft.languages),
        tags: distinctLabels(draft.tags),
      });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      onSaving(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={submit}
      aria-busy={busy}
      className="flex max-h-[calc(100dvh-4rem)] min-w-0 flex-col gap-4"
    >
      <DialogHeader className="shrink-0 pr-8">
        <DialogTitle>Nouveau projet</DialogTitle>
        <DialogDescription>
          Renseignez le nom du projet et les informations qui vous aideront à le retrouver.
        </DialogDescription>
      </DialogHeader>
      <fieldset
        disabled={busy}
        className="-mx-1 grid min-h-0 grid-cols-1 gap-4 overflow-y-auto overscroll-contain px-1 sm:grid-cols-2"
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="project-name" isRequired>
            Nom
          </Label>
          <Input
            id="project-name"
            ref={nameInput}
            aria-required="true"
            aria-invalid={!!nameError}
            aria-describedby={nameError ? "project-name-error" : undefined}
            autoComplete="off"
            value={draft.name}
            onChange={(e) => {
              setDraft({ ...draft, name: e.target.value });
              setNameError("");
            }}
          />
          <FieldError id="project-name" error={nameError} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="project-specialty">Spécialité</Label>
          <Input
            id="project-specialty"
            autoComplete="off"
            value={draft.specialty}
            onChange={(e) => setDraft({ ...draft, specialty: e.target.value })}
          />
        </div>
        <ProgrammingLanguageField
          values={draft.languages}
          onChange={(languages) => setDraft({ ...draft, languages })}
        />
        <ClassificationListField
          label="Tags"
          singular="Tag"
          values={draft.tags}
          onChange={(tags) => setDraft({ ...draft, tags })}
        />
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter className="shrink-0 flex-row flex-wrap justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="pointer-coarse:min-h-11"
          onClick={onCancel}
          disabled={busy}
        >
          Annuler
        </Button>
        <Button type="submit" size="sm" className="pointer-coarse:min-h-11" disabled={busy}>
          {busy && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          Créer le projet
        </Button>
      </DialogFooter>
    </form>
  );
}
