export const dynamic = "force-dynamic";

// Placeholder J0 : remplacé en J1 par le formulaire d'association.
export async function GET() {
  return new Response(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Campaign Preflight — configuration</title></head><body><h1>Campaign Preflight — configuration de la clé</h1><p>Formulaire en cours de mise en place.</p></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
