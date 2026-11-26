export function FieldError({ id, error }: { id: string; error?: string }) {
  return (
    error && (
      <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
        {error}
      </p>
    )
  );
}

export function focusFirstInvalidField(form: HTMLFormElement) {
  requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}
