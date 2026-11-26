import { Plus, Search } from "lucide-react";
import { useId, useState } from "react";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LANGUAGE_ALIASES, PROGRAMMING_LANGUAGES } from "@/lib/programming-languages";

export function ProgrammingLanguageField({
  values,
  onChange,
}: {
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">Langages</legend>
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="Langages du projet">
          {values.map((language) => (
            <li key={language}>
              <Badge variant="secondary" size="sm">
                {language}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="self-start pointer-coarse:min-h-11">
            <Plus aria-hidden="true" />
            {values.length > 0 ? "Modifier les langages" : "Ajouter un langage"}
          </Button>
        </DialogTrigger>
        <DialogContent className="w-[calc(100%-2rem)] gap-0 sm:max-w-md">
          {open && <LanguagePicker initialValues={values} onApply={onChange} />}
        </DialogContent>
      </Dialog>
    </fieldset>
  );
}

function LanguagePicker({ initialValues, onApply }: { initialValues: string[]; onApply: (values: string[]) => void }) {
  const [selected, setSelected] = useState(initialValues);
  const [query, setQuery] = useState("");
  const rowId = useId();
  const needle = query.trim().toLocaleLowerCase("fr");
  const visible = PROGRAMMING_LANGUAGES.filter((language) =>
    [language, ...(LANGUAGE_ALIASES[language] ?? [])].some((name) => name.toLocaleLowerCase("fr").includes(needle)),
  );
  return (
    <div className="flex max-h-[calc(100dvh-4rem)] min-w-0 flex-col gap-4">
      <DialogHeader className="shrink-0 pr-8">
        <DialogTitle>Langages de programmation</DialogTitle>
        <DialogDescription>Sélectionnez les langages utilisés dans ce projet.</DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 flex-col rounded-lg border">
        <div className="relative shrink-0 border-b">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Rechercher un langage"
            placeholder="Rechercher un langage…"
            className="h-10 border-0 pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {visible.length > 0 ? (
          <ul className="min-h-0 max-h-80 overflow-y-auto overscroll-contain p-1">
            {visible.map((language) => {
              const id = `${rowId}-${encodeURIComponent(language)}`;
              return (
                <li
                  key={language}
                  className="flex min-h-9 items-center gap-2 rounded-md px-2 hover:bg-accent focus-within:bg-accent pointer-coarse:min-h-11"
                >
                  <Checkbox
                    id={id}
                    checked={selected.includes(language)}
                    onCheckedChange={(checked) =>
                      setSelected((values) =>
                        checked ? [...values, language] : values.filter((value) => value !== language),
                      )
                    }
                  />
                  <label
                    htmlFor={id}
                    className="flex min-h-[inherit] min-w-0 flex-1 cursor-pointer items-center text-sm"
                  >
                    {language}
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p role="status" className="p-3 text-sm text-muted-foreground">
            Aucun langage trouvé.
          </p>
        )}
      </div>
      <DialogFooter className="shrink-0 flex-row flex-wrap items-center justify-end">
        <span role="status" className="mr-auto text-xs text-muted-foreground">
          {selected.length} sélectionné{selected.length > 1 ? "s" : ""}
        </span>
        <DialogClose asChild>
          <Button type="button" size="sm" variant="outline" className="pointer-coarse:min-h-11">
            Annuler
          </Button>
        </DialogClose>
        <DialogClose asChild>
          <Button type="button" size="sm" className="pointer-coarse:min-h-11" onClick={() => onApply(selected)}>
            Valider
          </Button>
        </DialogClose>
      </DialogFooter>
    </div>
  );
}
