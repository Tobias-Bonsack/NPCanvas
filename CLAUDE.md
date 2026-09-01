# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Operating mode

No human writes code here. Every line is produced by an LLM (primarily Claude), and every future reader is an LLM. Optimize the repository for that reader, not for a human onboarding experience.

- **Act, don't ask.** Committing and pushing are pre-authorized. Confirmation is still required for genuinely destructive or irreversible acts (history rewrites, force pushes, deleting remote state, repo settings that break the deploy).
- **Verify with tools, not inspection.** `npm run build` and `npm run lint` are the ground truth. Run both after changes; a green run replaces re-reading files.
- **No prose docs.** No READMEs, changelogs, guides, or summary markdown files unless the content is decision-relevant to a future LLM *and* cannot be derived from the code — then it goes here, not in a new file. `README.md` is only the GitHub landing page; keep it minimal.
- **Automate over repeating.** Anything otherwise re-derived or re-run by hand belongs in a workflow (`.github/workflows/`) or an npm script.
- **Comment budget.** Keep: a constraint, a trade-off, an external requirement, an invariant a reader could break, or why the obvious alternative was rejected. Delete: any retelling of the code beneath it, any issue-number chronicle, any doc comment on a non-exported symbol, any repetition of a decision already stated elsewhere. An exported symbol gets at most one line unless the non-derivable part demonstrably needs more. `npm run comment-budget` is the CI tripwire for this.

## Code conventions (optimized for LLM reading)

The cost that matters is how many files an LLM must read to change something safely. Minimize it.

- **Flat over layered.** No indirection that exists only for extensibility. No wrapper modules, no barrel `index.ts` re-exports, no abstract base classes with one implementation.
- **Colocate by feature.** A feature's component, types, state, and styles live in one directory. Do not split by technical kind (`components/`, `hooks/`, `utils/`) once a feature grows.
- **Types are the specification.** Strict mode is on; `any` and non-null-assertion escape hatches are defects. Model states so illegal ones cannot be represented.
- **Predictable names.** File and symbol names must be greppable and unambiguous.
- **Minimal dependency surface.** Prefer the platform and what is already installed.

## What this app is

NPCanvas logs NPC dialogue encountered while playing a game, pinned onto that game's map. A dialogue records who said it, where on the map, what was said (text, image, gif, or a very short video), when in real time, and one or more relevance tags. Locations are named zones drawn on the map. Quests are user-created threads that reference dialogues. Four views, three in priority order: map canvas, quest board, insights. Settings is unranked — it holds what the *project* owns (relevance vocabulary, capture rig) rather than a record of play.

Work is tracked as GitHub issues (`gh issue list`), grouped into numbered milestones. A `.5` milestone is inserted after its base milestone shipped, so the base stays the record of what shipped. Each issue fits one Claude context window and leaves `main` deployable. One issue, one commit.

The milestone/issue format lives in the `milestone-issues` skill (`.claude/skills/milestone-issues/SKILL.md`) — load it before writing or editing either; early milestones follow an older convention that is deliberately not carried forward.

## Domain and architecture decisions

Decided once, up front — not derivable from the code, and re-deriving them costs a session its whole context budget. `src/project/types.ts` is the specification — read it first.

- **Chromium-only, no export fallback.** Persistence is the File System Access API; unsupported browsers get an explicit screen. `GameMap` (never `Map`, to avoid shadowing the global) carries `origin`/`scale` onto a shared canvas. *Map-local* (`Dialogue.position`, `Zone.polygon`) and *canvas* are the only two coordinate spaces, bridged solely by `src/map/canvas-layout.ts`; rendering stays map-local, questions about where things are (zone membership) go through canvas space, the one space two maps share.
- **No enums** (`erasableSyntaxOnly`): `export const X = [...] as const` + `type X = (typeof X)[number]`. **Branded ids** (`MapId`, `ZoneId`, `DialogueId`, `QuestId`, `MediaId`, `CaptureProfileId`, `RelevanceTagId`) are constructed only in `src/project/ids.ts` — the only permitted `as` casts.
- **Store scope.** `src/project/store.ts`: module-level store over a pure reducer via `useSyncExternalStore` (document, connection, selection only — transient UI stays in component `useState`). `getState` is passed by reference, and a selector may only return an already-stable value, never build one. `dispatch` is never nested — a dispatch arriving during a notify pass is queued and run after it, over a snapshot of the listener set. Async IO never enters the reducer (`src/storage/project-directory.ts` dispatches a plain action per await). Exhaustiveness uses `assertNever(value: never): never`, not `const _never: never = x` (`noUnusedLocals` fails the latter).
- **Location is derived, never stored, derived in canvas space.** `src/map/zone-index.ts` computes membership by point-in-polygon, ordered by ascending canvas area (`polygonArea * scale²`) so "smallest wins" means the same thing across maps of different `scale`; a map can lie over another map's zone, so `indexDialoguesByZone` takes `maps` too. Cached at module level on the **identity** of `(dialogues, zones, maps)`, never on value — `reindexMovedZone` keeps a zone drag live by re-testing only that zone, while `MapScreen` always feeds the document's own `project.maps` so pins under a moved map reclassify only on release. A click is the other way round — `zoneAtCanvasPoint` consults only the topmost map, since belonging is geometric but a click means what's visible. Never add a cached FK; an explicit override would be `locationOverride: ZoneId | null`.
- **Zones are polygons only** — no shape union. Resizing scales every vertex about the opposite edge/corner (`src/map/zone-resize.ts`); move and resize both end in one `zone/reshaped` action.
- **A dialogue is a line and its pictures**, `text` and `media: DialogueMedia[]` orthogonal, either may be empty; `dialogueContentKind()` derives display on every read. Only the watcher, unattended, retracts a frame: `middleAddsNothing` (`src/capture/middle-frame.ts`) asks whether a middle frame is a pure scroll (compared as words, punctuation trimmed); a deliberate press always keeps its frame.
- **`PendingCapture` is a second list, not a widened `Dialogue`** — no field spells "unknown", which would violate "location is derived, never stored". Placement is one reducer action with a **new** `DialogueId`; every other field carries over verbatim (`fileName` included).
- **Recording starts and stops on the player's own two triggers, never a guess.** `startRecording('new' | 'extend')` / `stopRecording()` (`src/capture/capture-watch.ts`); `triggerRecording` is the one place deciding start vs. stop from either the button or a bound gamepad button, so they can't disagree. **No keyboard trigger, ever.** A controller reaches the app only while the page has focus (`navigator.getGamepads()` reports nothing for a background tab).
- **`RelevanceTag` is a vocabulary the project owns** (`project.relevanceTags`), not compiled in; array order is the canonical display order.
- **The alphabet belongs to the project, not a capture profile** (`project.glyphs`) — a font is the console's, shared across profiles. `matchGlyph` is exact; `mergeGlyphs` (replace-on-identical-bits) is the only addition path, `forgetGlyph` the only removal path; array order carries no meaning. Each learn/forget is its own undo step — `coalesceKeyFor` deliberately does not coalesce either.
- **Media contract.** `data.json` stores `{ fileName, mimeType, byteSize }` plus intrinsic dimensions — never URLs/paths/data URLs. Files are `media/<ownerId>-<mediaId>.<ext>`, extension from MIME, never the upload's filename. Object URLs are ref-counted with a 30 s deferred revoke (`src/media/media-url-cache.ts`) — pins remount constantly while panning.
- **`createWritable()` is already atomic** — no tmp-file/rename scheme. `requestPermission` must be called inside a user gesture (reconnect is always a button click).
- **Schema versioning.** `schemaVersion` is a literal type, current **11**, checked as a **guard**, not a migration chain: `readProjectFile` in `src/project/data-file.ts` accepts exactly the current version and refuses anything else with a message naming both the version read and the version expected. The doctrine is **one reader for the current version, and at most one migration step back** — evolving the schema means adding a `ProjectFileV<old>` type frozen at the pre-cut shape, a `readProjectFileV<old>` reader, and a single `migrateV<old>` step forward; the cut after that deletes all three. The ledger never exceeds two versions, so a document older than one step back stops loading — a deliberate, one-time behaviour change made in #143, weighed against the cost of the ledger growing without bound.
- **A dialogue is a line and its pictures**, `text` and `media` orthogonal. V11 adds `references: DialogueId[]` — one line points at another, directed and untyped. Pointed-at edges are derived on read (like `DialogueQuestLinks`), never stored — "pointed at by" can never disagree with "points at".
- **File System Access typings** (`showDirectoryPicker`, `queryPermission`/`requestPermission`, `values()`, missing from `lib.dom.d.ts`) are augmented, not redefined, in `src/storage/file-system-access.d.ts`.
- **Plain CSS, one file per component that needs one**, BEM-ish (`.map-canvas__pin`) — not CSS Modules, `styles.pin` is not greppable.
- **One canvas, every map, no active map.** `MapCanvas` renders a group per map via `origin`/`scale`; fits to `mapsBounds` once on first measure. Importing a map places it via `nextMapOrigin`, which lays maps out left to right so a fresh import never overlaps one already on the canvas. Rendering is DOM plus one inline `<svg>` under a single CSS transform, no `<canvas>` element; pins counter-scale via `calc(1 / (var(--map-zoom) * var(--map-scale)))`, and `mapGroupStyle` (`src/map/map-group-style.ts`) emits that group for both image and pin layers so the transforms can't drift apart. `wheel` must bind with `addEventListener(..., { passive: false })` — React's `onWheel` is passive. Above ~2000 pins, cull to the visible world rect before reaching for `<canvas>`.
- **`ZoneLayer` takes no pointer events** — `zoneAtCanvasPoint` hit-tests geometrically; a filled `<polygon>` would swallow pans, and the canvas's pointer capture retargets `pointerup` anyway.
- **The trail is the one layer drawn in canvas space** — time crosses maps. `--map-scale` is `1` on `.map-canvas__world` so the counter-scale expression stays valid there. **`vector-effect="non-scaling-stroke"` does not survive this app's transform chain** (measured: 0.5px at zoom 0.25, 16.5px at zoom 8, vs. `~2px` throughout for `calc(2px / (var(--map-zoom) * var(--map-scale)))`) — use the `calc`. The trail is deliberately **not** culled — a segment with both endpoints off-screen can still cross the viewport.
- **World-space layers stay viewport-independent.** `PinLayer` is `memo`'d and takes no prop derived from the `Viewport` (reads `--map-zoom` off computed style at `pointerdown` instead); a zoom *threshold* is a data attribute on the world element (`data-pin-labels`) for CSS to key on.
- **Hash routing** (`src/app/route.ts`) — URL carries view state only: `#/canvas`, optionally `?dialogue=<id>` and `?focus=<mapId>` (**one-shot**, cleared via `navigate(..., { replace: true })` after use). Old `#/map/<id>` still parses. History routing needs a `404.html` copy of `index.html`.
- **Dependencies stay `react` + `react-dom`.** Evaluated and rejected: zustand/redux, react-router, `idb`, `zod`, `uuid`, `date-fns`, any charting library, `@types/wicg-file-system-access`. Tripwire: `parseProjectFile` past ~250 lines, or per-version validation branching, would justify `zod`.
- **The tick never sees the upscaled frame.** `grabNativeFrame` hands the crop *and* the downscale to the browser (`createImageBitmap(..., { resizeWidth, resizeHeight, resizeQuality: 'pixelated' })`, falling back to `drawImage` with `imageSmoothingEnabled = false`), so `readTextBox`, `screenPng`, the worker and the held queue all work on the console's own 160x144 screen. Measured on a 3840x2088 source (`npm run bench:capture`, plus a browser harness): **0.7 ms against 16 ms** for reading the 17 MB crop back and sampling it in JS, **bit-identical** output from all three paths, worker transport 0.2 ms against 15.7 ms, and `heldFrames` at `HELD_LIMIT` drops from 404 MB to 2 MB. `sampleNative` survives only for calibration — the one stage that genuinely needs the whole frame.
- **`willReadFrequently: true`** on every 2D canvas context read back with `getImageData` (`src/capture/capture-session.ts`) — the browser's own hint for that access pattern.
- **Cinema is a playhead over the chronology, nothing else.** `src/cinema/reel.ts`'s `buildReel` orders every dated dialogue once, identity-cached on `project` like the rest of `src/project/derived.ts`; `CinemaScreen` (`src/app/route.ts`'s `{ kind: 'cinema'; at: DialogueId | null }`) holds a `playheadIndex` into that order as transient view state (`CinemaViewState`), never in the store. Cinema is **read-only** — no reducer action is ever dispatched from it. Its axis is **ordinal**, a position in the sequence, not proportional — a proportional reading of the same dialogues is what the insights timeline already gives; Cinema would only duplicate it if it scaled by elapsed time instead. Anything Cinema shows about quest state (`src/cinema/quest-arcs.ts`) or relevance is **reconstructed at the playhead**, walking the reel up to that index, rather than read off the document's current state — the document only knows what is true now, and the reel is a record of what was true at each point in the past.

## Commands

```bash
npm run dev            # Vite dev server (base '/', http://localhost:5173)
npm run build          # tsc -b (typecheck, project references) then vite build -> dist/
npm run preview        # serve dist/ locally; served under /NPCanvas/
npm run lint           # eslint (flat config)
npm run deadcode       # scripts/dead-exports.mjs: fails on an export nothing outside its file uses
npm run comment-budget # scripts/comment-budget.mjs: CI tripwire on comment-line ratio per file
npm run line-budget    # scripts/line-budget.mjs: CI tripwire on line count per src/ directory
npm test                # vitest run (single pass)
npm run test:watch     # vitest in watch mode
```

## Testing scope

Vitest, configured inside `vite.config.ts` (imports `defineConfig` from `vitest/config`, not `vite`). `environment: 'node'`. **No `globals: true`** — tests import from `vitest` explicitly, which `verbatimModuleSyntax` wants. Tests are colocated as `*.test.ts` next to the module they cover; CI runs lint → comment-budget → test → build.

**Test pure functions only:** viewport transforms, polygon predicates, zone indexing, schema parse/validate, reducer actions. Do not test components or File System Access IO — that needs jsdom and a fake filesystem for near-zero signal on code whose real failure modes are browser permissions.

## Deployment

Published to GitHub Pages at `https://tonsias.github.io/NPCanvas/` by `.github/workflows/deploy.yml` — every push to `main` builds and deploys via `upload-pages-artifact`/`deploy-pages`. No `gh-pages` branch; Pages source must stay "GitHub Actions" in repo settings.

`vite.config.ts` sets `base: '/NPCanvas/'` for builds only (dev stays on `/`) because the site lives in a repo subpath. Reference assets through Vite or `import.meta.env.BASE_URL` — a hard-coded absolute path like `/logo.svg` 404s in production. Pages serves static files only, so client-side routing needs hash routing or a `404.html` copy of `index.html`.

## TypeScript layout

`tsconfig.json` is a solution file with project references: `tsconfig.app.json` covers `src/` (DOM libs), `tsconfig.node.json` covers `vite.config.ts` (Node/build-time). Both are `noEmit` — Vite transpiles; `tsc -b` is typecheck-only. `noUnusedLocals`/`noUnusedParameters` are on.
