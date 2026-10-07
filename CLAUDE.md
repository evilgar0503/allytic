# Allytic

Auditor de accesibilidad web (axe-core + LLM) que verifica sus propios parches. Monorepo pnpm,
TypeScript estricto, desplegado en el plan Free de Cloudflare. Coste 0 €, sin tarjeta.

## Regla principal

**Tras cualquier cambio que afecte a funcionalidad, arquitectura, stack, alcance, límites o decisiones, actualiza `docs/IDEA.md` en el mismo commit. Antes de empezar una tarea, léelo.**

## Comandos

Requisitos: Node 24 (`.nvmrc`), pnpm vía corepack (`corepack enable`) y Chromium para Playwright
(`pnpm --filter allytic exec playwright install chromium`, una vez).

| Comando | Qué hace |
| --- | --- |
| `pnpm install` | Instala dependencias |
| `pnpm check` | Lint + typecheck + tests + build. Debe pasar antes de cada commit |
| `pnpm lint` | Biome (lint y formato) en modo comprobación |
| `pnpm format` | Biome aplicando arreglos seguros y formato |
| `pnpm typecheck` | `tsc --noEmit` en cada workspace |
| `pnpm test` | Vitest en los workspaces que tienen tests |
| `pnpm build` | Compila cada workspace a `dist/` |
| `pnpm --filter @allytic/core test` | Tests de un solo workspace |
| `pnpm build && node packages/cli/dist/bin.js audit <url|archivo>` | Ejecutar la CLI en local |
| `pnpm build && pnpm --filter @allytic/api dev` | Worker en local (necesita los paquetes compilados; el spike pide `SPIKE_TOKEN` en `apps/api/.dev.vars`) |
| `node packages/cli/dist/bin.js audit <url|archivo> --fix` | Lo mismo con explicaciones y parches verificados (necesita `GROQ_API_KEY` u `OPENROUTER_API_KEY` en `.env`) |
| `pnpm exec wrangler pages deploy fixtures/broken-site --project-name=allytic-broken-site` | Despliegue manual del sitio de ejemplo (lo normal es que lo haga la CI) |

## Estructura

- `packages/core`: dominio, normalización, LLM, verificación. **Sin dependencias de Node ni del DOM** en la API pública.
- `packages/cli`, `packages/action`: adaptadores de Node.
- `packages/page-scripts`: funciones que se ejecutan dentro de la página auditada (`page.evaluate`). Cada una debe ser autocontenida: sin imports ni referencias a nada declarado fuera de su cuerpo.
- `apps/api`: Cloudflare Worker. `src/ssrf` es código puro (validación de URL, IP y DNS); `src/browser` es lo que habla con el navegador remoto y se prueba con Chromium local. Los bindings se tipan a mano en `src/env.ts`.
- `apps/web`: SPA Vite + React.
- `fixtures/broken-site`: sitio roto a propósito. No "arreglar" su HTML; está excluido de Biome.
  Si cambias un defecto, actualiza `fixtures/broken-site.expected.json` (oráculo de los e2e) y su README.
- `evals/`: dataset y script de comparación de modelos.
- `docs/IDEA.md`: visión, ADRs, límites, roadmap y changelog de decisiones.

## Convenciones

- TypeScript `strict`; **sin `any`** (Biome lo marca como error). Sin `as` salvo justificación en comentario.
- ESM en todo el repo; imports relativos con extensión `.js`; `import type` para tipos.
- Errores tipados (clases o uniones discriminadas) con mensajes útiles para quien usa la CLI o la API.
- Entradas externas (salida del LLM, peticiones HTTP, mensajes `postMessage`, JSON de informes) validadas con zod.
- Tests junto al código: `foo.ts` → `foo.test.ts`. Helpers de test en `src/testing/` (excluido del build).
- Los paquetes del workspace se importan por nombre (`@allytic/core`); typecheck y tests los resuelven desde `src/`, el build desde `dist/`.
- Todo texto que venga de la página auditada **o del modelo** se escapa antes de escribirlo en Markdown, HTML o la terminal.
- El contenido de la página solo entra en los prompts como datos JSON del mensaje de usuario, nunca en las instrucciones.
- Los tests no llaman a proveedores reales: usan `src/testing/mock-llm-server.ts` o un proveedor falso. Las respuestas reales capturadas viven en `packages/core/src/testing/llm-responses.ts`.
- Los mensajes de errores transitorios del proveedor LLM son genéricos: acaban en informes y el texto original puede identificar la cuenta.
- Commits pequeños con Conventional Commits (`feat(core): …`, `fix(cli): …`, `docs: …`, `ci: …`, `chore: …`).
- No añadir dependencias sin justificarlas en `docs/IDEA.md` (sección "Stack y por qué"). Versiones exactas.
- Nada de secretos en el repo: solo `.env.example` y `.dev.vars.example`. Los reales van como secrets de Wrangler o de GitHub.
- Acciones de GitHub fijadas por SHA y con permisos mínimos.
- Toda URL que vaya a cargar el navegador de la API pasa por el guard de `src/ssrf`; no se navega ni se hace `fetch` a una URL del usuario por otro camino. Los mensajes de rechazo no incluyen direcciones resueltas.
- Honestidad del producto: nunca escribir "cumple WCAG", "conforme" ni "compliant" en interfaz, informes o documentación.
- Idiomas: `docs/IDEA.md` y `CLAUDE.md` en español; código, comentarios, README y mensajes de la herramienta en inglés.

## Forma de trabajar

Por fases (ver roadmap en `docs/IDEA.md`). Al terminar cada fase: `pnpm check`, actualizar
`docs/IDEA.md`, resumen de 5 líneas con lo hecho y lo pendiente, y parar para revisión.
