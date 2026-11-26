export { cn } from "cn";

export function focusDialogContent(event: Event) {
  if (event.defaultPrevented || !(event.target instanceof HTMLElement)) return;
  event.preventDefault();
  event.target.focus({ preventScroll: true });
}
