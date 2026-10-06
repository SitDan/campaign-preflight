# Campaign Preflight — instructions de dépôt

POC : serveur MCP (Next.js sur Vercel) + composant ChatGPT pour vérifier un kit d'annonces Instagram Feed (images) avant transmission à l'agence.

## Commandes (Node 24, pnpm)
- `pnpm dev` — widget + Next en local
- `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` · `pnpm check` (tout)
- `pnpm eval` — mini-évaluation API réelle, locale, hors CI (clé dans `.env.eval.local`, jamais affichée)

## Architecture
- `src/domain` : fonctions pures (CSV, règles, rapport, contrat IA) — aucune dépendance Next/Redis/OpenAI.
- `src/services` : session, run, analyse. Frontières injectées : `SessionStore`, `VisionAnalyzer` seulement.
- `src/adapters` : Upstash Redis (CAS Lua), OpenAI (Responses), sharp.
- `src/security` : capacités, chiffrement AES-256-GCM, CORS, origine.
- `src/widget` : composant HTML/TS (esbuild → `src/mcp/widget-bundle.generated.ts`).
- `src/mcp` + `src/app/mcp/route.ts` : deux outils publics + ressource UI.
- `rules/instagram-feed.json` : règles Meta sourcées et datées + limites POC séparées.

## Invariants
- La clé OpenAI n'apparaît jamais dans le chat, le widget, MCP, une URL, un log ou Redis en clair.
- Bearer : en mémoire du widget, header Authorization uniquement. Code d'association : usage unique, 10 min.
- Plafonds dans `src/config/limits.ts`, vérifiés côté serveur avant tout traitement coûteux.
- Un seul modèle (`OPENAI_MODEL`), `maxRetries: 0`, aucun fallback ni clé de l'auteur.
- Erreur IA ⇒ mesures techniques conservées et visibles. Source non vérifiée ⇒ jamais « pass ».
- Limites POC ≠ règles Meta. Pas de badge « conforme ».
- Faux fournisseurs uniquement dans `tests/`, jamais atteignables en production.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
