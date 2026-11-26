import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ClassificationListField({
  list,
  label,
  singular,
  values,
  onChange,
}: {
  list?: string;
  label: string;
  singular: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      {values.map((value, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: editable strings are identified by their position
        <div key={index} className="flex items-center gap-1">
          <Input
            aria-label={`${singular} ${index + 1}`}
            list={list}
            autoComplete="off"
            value={value}
            onChange={(event) => onChange(values.map((entry, at) => (at === index ? event.target.value : entry)))}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 pointer-coarse:size-11"
            aria-label={`Retirer ${singular.toLowerCase()} ${index + 1}`}
            onClick={() => onChange(values.filter((_, at) => at !== index))}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start pointer-coarse:min-h-11"
        onClick={() => onChange([...values, ""])}
      >
        <Plus aria-hidden="true" />
        Ajouter un {singular.toLowerCase()}
      </Button>
    </fieldset>
  );
}
