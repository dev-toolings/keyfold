// User preferences kept in localStorage. Never a secret.
const HIBP_KEY = "keyfold.hibp";

/** Whether the user turned on the Have I Been Pwned check. */
export function hibpEnabled(): boolean {
  return localStorage.getItem(HIBP_KEY) === "on";
}

export function setHibpEnabled(on: boolean): void {
  if (on) localStorage.setItem(HIBP_KEY, "on");
  else localStorage.removeItem(HIBP_KEY);
}
