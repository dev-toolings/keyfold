// Copies a secret and clears the clipboard 30 s later, as password managers do.
export const CLEAR_SECONDS = 30;

let timer: ReturnType<typeof setTimeout> | undefined;

/** Copies text that is not a secret: a pending clear would erase it, so it is cancelled. */
export async function copyText(text: string): Promise<void> {
  clearTimeout(timer);
  await navigator.clipboard.writeText(text);
}

export async function copySecret(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  clearTimeout(timer);
  // Fails when the page has lost focus by then: nothing else can be done from a page.
  timer = setTimeout(() => navigator.clipboard.writeText("").catch(() => {}), CLEAR_SECONDS * 1000);
}
