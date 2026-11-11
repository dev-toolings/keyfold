// Known breaches, through the Have I Been Pwned "Pwned Passwords" range API
// (k-anonymity): only the first 5 hex characters of the value's SHA-1 leave
// the device. Off unless the user turns it on.

export const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range/";

/** Number of times value appears in known breaches; 0 when absent. */
export async function pwnedCount(value: string, fetchFn: typeof fetch = fetch): Promise<number> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value)));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  const prefix = hex.slice(0, 5);
  const suffix = hex.slice(5);
  // Add-Padding makes every answer about the same size, so its length tells nothing.
  const res = await fetchFn(HIBP_RANGE_URL + prefix, { headers: { "Add-Padding": "true" } });
  if (!res.ok) throw new Error(`Have I Been Pwned a répondu ${res.status}.`);
  for (const line of (await res.text()).split("\n")) {
    const [s, n] = line.trim().split(":");
    if (s === suffix) return Number(n);
  }
  return 0;
}
