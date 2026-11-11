import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Resolves the "@/*" alias from tsconfig.json paths.
  resolve: { tsconfigPaths: true },
  server: {
    // Same variable as the CLI: point both at another vault server if needed.
    proxy: { "/api": process.env.KEYFOLD_SERVER ?? "http://127.0.0.1:8717" },
  },
});
