# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Operating mode

No human writes code here. Every line is produced by an LLM (primarily Claude), and every future
reader is an LLM. Optimize the repository for that reader, not for a human onboarding experience.

- **Act, don't ask.** Committing and pushing are pre-authorized — commit and push finished work to
  `main` without confirmation. Confirmation is still required for genuinely destructive or
  irreversible acts (history rewrites, force pushes, deleting remote state, repo settings that
  break the deploy).
- **Verify with tools, not inspection.** `npm run build` (typecheck + build) and `npm run lint` are
  the ground truth. Run both after changes; a green run replaces re-reading files.
- **No prose docs.** Do not write READMEs, changelogs, guides, or summary markdown files unless the
  content is decision-relevant to a future LLM *and* cannot be derived from the code. When that bar
  is met, add it here in CLAUDE.md instead of creating a new file. `README.md` exists only as the
  repo's GitHub landing page — keep it minimal and do not expand it.
- **Automate over repeating.** Anything that would otherwise be re-derived or re-run by hand belongs
  in a workflow: a GitHub Actions workflow in `.github/workflows/` for anything CI can own, an npm
  script for anything local. Prefer adding the automation over performing the steps manually a
  second time. Claude Code workflows, skills, and subagents are likewise pre-authorized — use them
  whenever a task fits one.

## Code conventions (optimized for LLM reading)

The cost that matters is how many files an LLM must read to change something safely. Minimize it.

- **Flat over layered.** No indirection that exists only for extensibility. No wrapper modules, no
  barrel `index.ts` re-exports, no abstract base classes with one implementation.
- **Colocate by feature.** A feature's component, types, state, and styles live in one directory.
  Do not split by technical kind (`components/`, `hooks/`, `utils/`) once a feature grows.
- **Types are the specification.** Strict mode is on; `any` and non-null-assertion escape hatches
  are defects. Model states so illegal ones cannot be represented — a discriminated union beats
  three loosely-related optional booleans, because it makes the invariant machine-checkable.
- **Predictable names.** File and symbol names must be greppable and unambiguous. A future session
  finds code by `Grep`/`Glob`, so a name that requires reading the file to understand costs a read.
- **Comments only for the non-derivable.** Explain *why* (constraints, trade-offs, external
  requirements). Never restate what the code does.
- **Minimal dependency surface.** Prefer the platform and what is already installed. Each new
  dependency is API surface a future session must learn before it can edit safely.

## What this app is

NPCanvas logs NPC dialogue encountered while playing a game, pinned onto that game's map. A dialogue
records who said it, where on the map, what was said (text, image, gif, or a very short video), when
in real time, and one or more relevance tags. Locations are named zones drawn on the map. Quests are
user-created threads that reference dialogues. Three views, in priority order: map canvas, quest
board, insights.

Work is tracked as GitHub issues (`gh issue list`), grouped into milestones M1–M7. Each issue is
sized to fit one Claude context window and leaves `main` deployable. Do not batch issues — one issue,
one commit.

## Domain and architecture decisions

Decided once, up front. These are not derivable from the code, and re-deriving them costs a session
its whole context budget. `src/project/types.ts` is the specification — read it first.

- **Chromium-only by design.** Persistence is the File System Access API: the user picks a project
  folder holding `data.json` and a `media/` subfolder. Non-supporting browsers get an explicit
  unsupported screen. There is deliberately **no** download/export fallback — do not add one.
- **`GameMap`, never `Map`.** The domain map type must not shadow the global `Map` constructor.
- **No enums** (`erasableSyntaxOnly` is on). The pattern is `export const X = [...] as const` plus
  `type X = (typeof X)[number]` — runtime list and union type from one declaration.
- **Branded ids** (`MapId`, `ZoneId`, `DialogueId`, `QuestId`) are constructed only in
  `src/project/ids.ts`. Those are the only permitted `as` casts on ids.
- **Store scope.** `src/project/store.ts` is a module-level store over a pure reducer, read through
  `useSyncExternalStore`. It holds the persisted document, connection state, and selection.
  Transient UI — canvas viewport, active tool, form drafts, filter bar — stays in component
  `useState`. Do not migrate it into the store, and do not replace the store with context.
- **`useSyncExternalStore` contract.** Pass `getState` by reference. A snapshot function that builds
  a new object on each call is an infinite render loop.
- **Async IO never enters the reducer.** `src/storage/project-directory.ts` awaits IO and dispatches
  a plain action per step. No thunks, no middleware.
- **Exhaustiveness uses `assertNever(value: never): never`**, not `const _never: never = x` —
  `noUnusedLocals` fails the latter.
- **Location is derived, never stored.** `Dialogue` carries no `zoneId`; `src/map/zone-index.ts`
  computes membership by point-in-polygon, returning zone ids ordered by ascending area so the most
  specific overlapping zone comes first. A cached FK would silently go stale when a zone moves. If an
  explicit override is ever needed, add `locationOverride: ZoneId | null` — never a cache.
- **Zones are polygons only.** Rectangles are 4-point polygons. Do not introduce a shape union.
- **Media contract.** `data.json` stores `{ fileName, mimeType, byteSize }` plus intrinsic
  dimensions — never URLs, paths, or data URLs. Files are `media/<dialogueId>.<ext>` with the
  extension derived from the MIME type, never from the upload's filename (untrusted, and this makes
  collisions impossible by construction). Object URLs are ref-counted with a 30 s deferred revoke in
  `src/media/media-url-cache.ts`, because pins remount constantly while panning.
- **`createWritable()` is already atomic** (swap file, committed on `close()`). Do not add a
  tmp-file/rename scheme.
- **`requestPermission` must be called inside a user gesture.** Reconnect is always a button click.
- **Schema versioning.** `schemaVersion` is a literal type. To evolve: add `ProjectFileV2`, widen
  `ProjectFile` to the union, branch in `parseProjectFile`, migrate forward on load. Never redefine
  the meaning of an existing field.
- **Canvas rendering is DOM plus one inline `<svg>` under a single CSS transform** — no `<canvas>`.
  Pins counter-scale via the `--map-zoom` custom property (one property write per frame instead of N
  element updates); zone strokes use `vector-effect="non-scaling-stroke"`. `wheel` must be bound with
  `addEventListener(..., { passive: false })` — React's `onWheel` is passive and `preventDefault()`
  silently fails there. If pin counts exceed ~2000, cull to the visible world rect before considering
  `<canvas>`.
- **Hash routing**, hand-rolled in `src/app/route.ts`, because Pages is static. The URL carries view
  state only, never data. Switching to history routing requires emitting `404.html` as a copy of
  `index.html`.
- **Dependencies.** Runtime deps stay `react` + `react-dom`. Evaluated and rejected: zustand/redux
  (the store is ~25 lines of platform API), react-router, `idb`, `zod`, `uuid`
  (`crypto.randomUUID()`), `date-fns` (`Intl.DateTimeFormat`), any charting library (inline SVG by
  hand), `@types/wicg-file-system-access` (conflicts with the interfaces `lib.dom` already ships).
  One tripwire: if `parseProjectFile` exceeds ~250 lines, or a second schema version forces
  per-version validation, `zod` becomes justified — nothing else on that list does.
- **File System Access typings.** `lib.dom.d.ts` ships the handle interfaces but not
  `showDirectoryPicker`, `queryPermission`/`requestPermission`, or `values()`. Those live in
  `src/storage/file-system-access.d.ts` as augmentations, not redefinitions.
- **Plain CSS, one file per component that needs one**, BEM-ish prefixed by feature
  (`.map-canvas__pin`). Not CSS Modules — `styles.pin` is not greppable.

## Commands

```bash
npm run dev        # Vite dev server (base '/', http://localhost:5173)
npm run build      # tsc -b (typecheck, project references) then vite build -> dist/
npm run preview    # serve dist/ locally; served under /NPCanvas/
npm run lint       # eslint (flat config)
npm test           # vitest run (single pass)
npm run test:watch # vitest in watch mode
```

## Testing scope

Vitest, configured inside `vite.config.ts` (which therefore imports `defineConfig` from
`vitest/config`, not from `vite`). `environment: 'node'`. **No `globals: true`** — tests
`import { describe, it, expect } from 'vitest'` explicitly, which is what `verbatimModuleSyntax`
wants and what keeps the `types` array untouched. Tests are colocated as `*.test.ts` next to the
module they cover; `tsc -b` typechecks them because they live under `src/`. CI runs lint → test →
build.

**Test pure functions only:** viewport transforms, polygon predicates, zone indexing, schema
parse/validate, reducer actions. Do not test components or File System Access IO — that needs jsdom,
a fake filesystem, and a testing library, which is three dependencies for near-zero signal on code
whose real failure modes are browser permission behaviour.

## Deployment

Published to GitHub Pages at `https://tobias-bonsack.github.io/NPCanvas/` by
`.github/workflows/deploy.yml` — every push to `main` builds and deploys via
`upload-pages-artifact` / `deploy-pages`. There is no `gh-pages` branch. Pages source must stay set
to "GitHub Actions" in repo settings.

Because the site lives in a repo subpath, `vite.config.ts` sets `base: '/NPCanvas/'` for builds only
(dev stays on `/`). Consequences:

- Renaming the repo requires updating `base`.
- Reference assets through Vite (`import logo from './logo.svg'`) or `import.meta.env.BASE_URL`.
  Hard-coded absolute paths like `/logo.svg` resolve outside the base path and 404 in production.
- Pages serves static files only — client-side routing needs hash routing or a `404.html` copy of
  `index.html`.

## TypeScript layout

`tsconfig.json` is a solution file with project references: `tsconfig.app.json` covers `src/` (DOM
libs), `tsconfig.node.json` covers `vite.config.ts` (Node/build-time). Compiler options live in
those two files, not the root. Both are `noEmit` — Vite transpiles; `tsc -b` is typecheck-only.
`noUnusedLocals`/`noUnusedParameters` are on, so unused bindings fail the build.
