// Owner: GEO worker. Stub: will serve the short llms.txt summary of the product.

// Without it, output: "export" refuses the route at build time.
export const dynamic = "force-static";

export function GET(): Response {
  return new Response("# Keyfold\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
