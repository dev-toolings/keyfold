// The public product site (keyfold.pulseview.app) is the same app built with
// VITE_SITE_ONLY=1: only the landing pages, no vault. A self-hosted build
// leaves it unset and serves the vault under /personal.
export const SITE_ONLY = import.meta.env.VITE_SITE_ONLY === "1";

export const REPO_URL = "https://github.com/dev-toolings/keyfold";
