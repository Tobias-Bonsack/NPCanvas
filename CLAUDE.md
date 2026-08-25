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

Work is tracked as GitHub issues (`gh issue list`), grouped into numbered milestones. A `.5`
milestone is an increment inserted after its base milestone shipped, so the base stays the record of
what shipped rather than being retconned. Each issue is sized to fit one Claude context window and
leaves `main` deployable. Do not batch issues — one issue, one commit.

The milestone and issue format — titles, the fixed body schema, labels, and the `gh` invocations
that survive Windows — lives in the `milestone-issues` skill
(`.claude/skills/milestone-issues/SKILL.md`). Load it before writing or editing either, rather than
inferring the shape from a sample of existing issues: the early milestones follow an older
convention that is deliberately not carried forward.

## Domain and architecture decisions

Decided once, up front. These are not derivable from the code, and re-deriving them costs a session
its whole context budget. `src/project/types.ts` is the specification — read it first.

- **Chromium-only by design.** Persistence is the File System Access API: the user picks a project
  folder holding `data.json` and a `media/` subfolder. Non-supporting browsers get an explicit
  unsupported screen. There is deliberately **no** download/export fallback — do not add one.
- **`GameMap`, never `Map`.** The domain map type must not shadow the global `Map` constructor. A
  `GameMap` carries its placement on the shared canvas: `origin` (top-left, canvas space) and
  `scale` (canvas units per map pixel, `1` being native size).
- **Two coordinate spaces, and only maps bridge them.** *Map-local* is pixels within one map image:
  `Dialogue.position` and `Zone.polygon` are map-local and stay that way, and `Dialogue.mapId` is a
  real association. *Canvas* is the shared space every map sits in. Storing positions in canvas
  space would strand a map's pins where the map used to be as soon as it moved; instead the map
  carries an origin and its contents ride along for free. `src/map/canvas-layout.ts` owns every
  conversion and every placement policy — nothing re-derives one inline. This does not contradict
  "location is derived, never stored": a zone is a region *within* a map, while a map is the
  substrate the coordinates are expressed in. Rendering stays purely map-local — every world-space
  layer but the trail writes stored coordinates verbatim under a per-map group — but *questions
  about where things are* are answered in canvas space, because that is the only space in which two
  maps have a spatial relation at all. Zone membership is the case that matters (below).
- **No enums** (`erasableSyntaxOnly` is on). The pattern is `export const X = [...] as const` plus
  `type X = (typeof X)[number]` — runtime list and union type from one declaration.
- **Branded ids** (`MapId`, `ZoneId`, `DialogueId`, `QuestId`, `MediaId`, `CaptureProfileId`,
  `RelevanceTagId`) are constructed only in `src/project/ids.ts`. Those are the only permitted `as`
  casts on ids.
- **Store scope.** `src/project/store.ts` is a module-level store over a pure reducer, read through
  `useSyncExternalStore`. It holds the persisted document, connection state, and selection.
  Transient UI — canvas viewport, active tool, dialogue panel width, form drafts, filter bar —
  stays in component `useState`. Do not migrate it into the store, and do not replace the store with context.
- **`useSyncExternalStore` contract.** Pass `getState` by reference. A snapshot function that builds
  a new object on each call is an infinite render loop. A *selector* over the state is therefore
  only ever allowed to return something already stable: a field of `AppState` (`useSaveState`), or a
  previously returned `AppState` (`useAppStateExceptSave`, which hands back the last state whenever
  `save` is the only field that moved, so a save cycle re-renders the Nav and not the canvas). Never
  build the return value.
- **`dispatch` is never nested.** Autosave's listener dispatches `save/pending` synchronously, so a
  dispatch arriving during a notify pass is *queued* and run after it, and each pass iterates a
  snapshot of the listener set. Without both, listeners registered before and after autosave would
  see different states for one change. Do not "simplify" either back.
- **Async IO never enters the reducer.** `src/storage/project-directory.ts` awaits IO and dispatches
  a plain action per step. No thunks, no middleware.
- **Exhaustiveness uses `assertNever(value: never): never`**, not `const _never: never = x` —
  `noUnusedLocals` fails the latter.
- **Location is derived, never stored, and derived in canvas space.** `Dialogue` carries no
  `zoneId`; `src/map/zone-index.ts` computes membership by point-in-polygon, returning zone ids
  ordered by ascending **canvas** area so the most specific overlapping zone comes first.
  `indexDialoguesByZone` therefore takes `maps` as well: a house interior imported as its own map and
  dropped onto the town it stands in is a map lying over another map's zone, and every line heard
  inside it was heard in that town — the old `zone.mapId === dialogue.mapId` rule answered "outside
  any zone" for all of them. The pin goes up into canvas space once and back down into each candidate
  zone's own space; the stored polygons are never converted. Ordering is canvas area
  (`polygonArea * scale²`) because "smallest wins" has to mean the same thing across maps whose
  `scale` differs, and a candidate bucket is geometric (`rectsOverlap` of the two canvas rects), so
  maps laid apart — where `nextMapOrigin` puts every import — still cost what they always did. The
  test is per **pin**, not per map: a map straddling a zone edge has pins on both sides of it.
  A click is deliberately the other way round — `zoneAtCanvasPoint` consults only the topmost map at
  the point, because belonging is geometric while a click means what the user can see. Derived, but
  not recomputed blindly: the index and its area-sorted candidate list are cached at module level on
  the *identity* of `(dialogues, zones, maps)`, which is what makes the canvas, the quest board and
  the insights screen share one build across a route change; and a zone drag goes through
  `reindexMovedZone`, which re-tests only the dragged zone, against the pins of every map it reaches.
  Both are caches on identity, never on value, and neither may disagree with a full build —
  `zone-index.test.ts` pins that. `MapScreen` feeds all three functions `project.maps`, never the
  drag-previewed `placedMaps`: a map drag would otherwise force a full rebuild per frame, so pins
  under a moved map reclassify on release, while a zone drag stays live. A cached FK would silently
  go stale when a zone *or a map* moves. If an explicit override is ever needed, add
  `locationOverride: ZoneId | null` — never a cache.
- **Zones are polygons only.** Rectangles are 4-point polygons. Do not introduce a shape union.
  Resizing one is therefore a *scale of every vertex* about the opposite edge or corner
  (`src/map/zone-resize.ts`), never an edit of a single vertex: the eight grips are the
  bounding box's, so a hand-drawn outline stretches instead of acquiring a dent, and a
  rectangle stays a rectangle. Moving and resizing both end in one `zone/reshaped` action,
  because a zone is nothing but its polygon and the reducer cannot tell — nor need to tell —
  which gesture produced it. The grips are drawn only for the selected zone and only under the
  zone tool, and they are the one world-space element that **takes** pointer events: purely to
  carry a resize cursor, with no handler of their own, so the press still bubbles to the canvas
  and `handleAtCanvasPoint` decides geometrically which grip it was.
- **A dialogue is a line and its pictures.** `Dialogue.text` and `Dialogue.media: DialogueMedia[]`
  are orthogonal fields, not an exclusive union: a line that ran over five text boxes is one thing
  said and five frames proving it, and a capture appends both. `text` may be empty (a picture not
  yet transcribed) and `media` may be empty (a line typed by hand). What a pin, a row or the kind
  filter shows comes from `dialogueContentKind()` — the first medium's kind, or `'text'` — derived
  on every read, never stored. The **watcher alone** may take a picture back once the box after it
  has been written: `middleAddsNothing` (`src/capture/middle-frame.ts`) asks whether the middle of
  three boxes can be cut at one point so its front is a suffix of the box before and its back a
  prefix of the box after — the scroll, stated exactly — and if it can, `keepWindow` removes it and
  deletes its file. Compared as *words* with punctuation trimmed off their ends, because a comma at
  a scrolled line's end is shown by the middle box and by neither neighbour, and a character-exact
  test would therefore keep nearly every frame. An empty `before` is the same question asked of a
  box that *filled* rather than scrolled, which is why a second frame can take back the first. The
  line's text is never touched: it was already joined from every box, and the removed frame's words
  are all still in it. A deliberate press keeps its frame unconditionally, exactly as it already
  keeps it against `appendOutcome` — only the caller that fires unattended judges a frame by what
  came after it. Unattended is the whole of that rule: nothing decides *for* the user, and the
  three ways a `GlyphLearner` closes are what says so. Over a manual capture it offers all three
  — discard the frame, keep the picture without a line, or name the tiles and get both — with
  Escape on the discard, which is safe there because that frame has not been written yet. Over the
  watcher's held queue and over the bar's trial read it offers only Cancel, because neither has
  anything to throw away: the queue is emptied from `HeldNote` (`discardHeldFrames`), where it is
  visible whether or not a learner could ask anything, and behind a confirmation, since a held
  frame is the only record of a box the game has long since advanced past.
- **An unplaced capture is a second list, not a widened `Dialogue`.** `PendingCapture` is
  everything a `Dialogue` is except `mapId` and `position`, for a conversation the watcher
  recorded before anyone said where it happened. There is deliberately no field to spell
  "unknown" in — **location is derived, never stored** (below), so an invented position would
  read as a confident claim rather than as missing. The other obvious shape, a placed/unplaced
  union on `Dialogue`, is worse: every reader that already knows a dialogue has a position —
  `PinLayer`, `zone-index.ts`, `search-index.ts`, `insights/filters.ts`, the quest board — would
  have to narrow past the new state to make one thing representable. A second list leaves every
  one of them untouched by construction: a capture is invisible to search, insights and quests
  until `pending-capture/placed` turns it into a real `Dialogue`, which is correct rather than an
  oversight. Placement is one reducer action carrying a **new** `DialogueId`, so the capture
  leaving `pendingCaptures` and the dialogue appearing in `dialogues` are one undo step and cannot
  half-happen; every field but the placement — `npcName`, `text`, `media`, `spokenAt`,
  `relevance` — carries over verbatim, media's `fileName` included (see Media contract).
- **Relevance is a vocabulary the project owns, not a compiled-in constant.** A `RelevanceTag` is a
  user-owned coloured record (`{ id, name, hue }`), exactly the shape `Zone` and `Quest` already use,
  stored in `project.relevanceTags`. That array's own order is the canonical order — the position a
  chart segment, a pin band, and a filter chip all draw in, and the order the reducer normalizes
  `Dialogue.relevance` (a deduplicated `RelevanceTagId[]`) against on every edit.
- **The alphabet belongs to the project, not to a capture profile.** Every field of a
  `CaptureProfile` is a measurement — `screenRect`, `nativeWidth/Height`, `textRect` — and a font is
  not one: it is the console's, and it is the same whether the box being read is the dialogue box or
  the Pokédex panel. So `project.glyphs` holds it and `readTextBox(frame, profile, glyphs)` takes it
  as a separate argument. Per-profile alphabets meant a second profile aimed at another box on the
  same game re-learned the whole font tile by tile. Unlike `relevanceTags`, the array's **order
  carries no meaning**: `matchGlyph` is an exact lookup and `mergeGlyphs` keeps the bitmaps unique,
  so nothing may start reading the position of an entry — `GlyphSet` sorts for display only.
  `mergeGlyphs` is the only addition path (it replaces on identical bits, which is what makes
  re-learning the correction path) and `forgetGlyph` the only removal one — it hands back the array
  it was given when nothing matched, which is how the reducer spends no undo step on a removal of
  nothing. Removal exists because re-learning cannot reach every mistake: a tile wrongly ticked
  *Not text* matches silently from then on and never lands in `unknown` again, so the learner would
  never ask about it a second time. Each learn and each forget is its own undo step —
  `coalesceKeyFor` deliberately does not coalesce either — which is why forgetting has no
  confirmation prompt.
- **Media contract.** `data.json` stores `{ fileName, mimeType, byteSize }` plus intrinsic
  dimensions — never URLs, paths, or data URLs. Files are `media/<dialogueId>-<mediaId>.<ext>` with
  the extension derived from the MIME type, never from the upload's filename (untrusted, and both
  ids together keep collisions impossible by construction now that one dialogue owns several
  files). A `MediaId` is what a remove or a reorder addresses, so the list needs no index
  arithmetic anywhere outside the reducer. Files migrated from V3 keep their old
  `<dialogueId>.<ext>` name: `fileName` has always been stored rather than derived, and a migration
  is pure and must not touch `media/`. A capture's files are named from its `PendingCaptureId`
  instead — `media/<pendingCaptureId>-<mediaId>.<ext>` — and keep that name after
  `pending-capture/placed` turns the capture into a `Dialogue`: placement moves no file in
  `media/`, only the record that names it, so `importDialogueMedia`'s owner parameter is
  `DialogueId | PendingCaptureId` and builds the file name from whichever it is handed. Object
  URLs are ref-counted with a 30 s deferred revoke in `src/media/media-url-cache.ts`, because pins
  remount constantly while panning.
- **`createWritable()` is already atomic** (swap file, committed on `close()`). Do not add a
  tmp-file/rename scheme.
- **`requestPermission` must be called inside a user gesture.** Reconnect is always a button click.
- **Schema versioning.** `schemaVersion` is a literal type, and the current version is **7**. To
  evolve: add `ProjectFileV8`, widen `StoredProjectFile` to include it, point `ProjectFile` at the
  new version, branch in `readProjectFile`, and migrate forward on load. `StoredProjectFile` is the
  union of on-disk shapes and is `parseProjectFile`'s business alone; `ProjectFile` is always the
  newest version, which is the only shape the store, the components, and writes ever see. Never
  redefine the meaning of an existing field. **Migrations chain one step at a time** — `case 1` runs
  `migrateV6(migrateV5(migrateV4(migrateV3(migrateV2(migrateV1(…))))))` — so a new version adds one
  function and one case, not one per shape already on disk. The V1→V2 migration lays legacy maps out left to right through
  `nextMapOrigin`, and the V2→V3 migration hands each quest a hue through `nextQuestHue`, building
  the array up as it goes so each quest sees those already coloured. Both call the same function the
  live app calls (an import; a newly created quest), which is what makes a migrated project
  indistinguishable from one built by hand. The V3→V4 migration turns the old exclusive `content`
  slot into the new pair: a text dialogue becomes `{ text, media: [] }`, a media one
  `{ text: '', media: [one medium] }` with a fresh `MediaId` and its `fileName` untouched, and every
  project gets `captureProfiles: []`. `DialogueV3` is kept in `types.ts` as the pre-migration shape,
  beside `GameMapV1` and `QuestV2`, and is the only thing `readDialogueV3` still builds. The V4→V5
  migration (`migrateV4`) builds the project's `relevanceTags` once via the same `defaultRelevanceTags()`
  a brand new project seeds, then rewrites every dialogue's compiled-in relevance slugs into the
  matching tag ids — mirroring the V2→V3 pattern of calling the one function the live app also calls.
  `DialogueV4` is kept beside `DialogueV3` as the pre-migration shape. The V5→V6 migration
  (`migrateV5`) folds every profile's alphabet into the project's one, in profile order, keeping the
  **first** naming of a repeated bitmap — and is the one migration that deliberately does *not* call
  the function the live app calls, because `mergeGlyphs` replaces on identical bits and would let
  the last profile taught overrule every earlier one. Profiles are appended in creation order, which
  is the order they were taught in, and the fullest alphabet is the one taught first; a later
  profile aimed at a second box on the same console is re-learning tiles, not correcting them. A
  disagreement is fixable in two clicks now that `forgetGlyph` and the learner exist, which is what
  lets this be a stated rule rather than a guess. `CaptureProfileV5` is kept beside `DialogueV4` as
  the pre-migration shape, and is the only thing `readCaptureProfileV5` still builds. The V6→V7
  migration (`migrateV6`) is the simplest one on record: it sets `pendingCaptures: []` and nothing
  else, because nothing before V7 could have written a `PendingCapture` — there is no earlier shape
  to fold, rename or reconcile.
- **One canvas, every map.** There is no active map. `MapCanvas` renders a group per map inside the
  world element, placed by `origin` and sized by `scale`, and every dialogue in the project is
  pinned onto the map it belongs to. It fits to `mapsBounds` once, when the container is first
  measured; importing or moving a map deliberately does not move the viewport.
- **Canvas rendering is DOM plus one inline `<svg>` under a single CSS transform** — no `<canvas>`.
  Pins counter-scale via `calc(1 / (var(--map-zoom) * var(--map-scale)))`: `--map-zoom` is one
  property write per frame on the world element, `--map-scale` one per map on its group, and both
  inherit — so a zoom still costs no per-pin style update. Their product is screen pixels per
  map-local pixel, which is also what a pin drag delta must be divided by. `mapGroupStyle` in
  `src/map/map-group-style.ts` emits that group for both the image layer and the pin layer, so the
  two transforms cannot drift apart. Zone strokes use `vector-effect="non-scaling-stroke"`. `ZoneLayer`
  takes **no pointer events**: a zone is hit-tested geometrically by `zoneAtCanvasPoint`, because a
  filled `<polygon>` that took the pointer would swallow every pan beginning inside a zone — and the
  canvas's own pointer capture retargets the `pointerup` anyway, so the polygon would never see the
  click it captured. `wheel` must be bound with
  `addEventListener(..., { passive: false })` — React's `onWheel` is passive and `preventDefault()`
  silently fails there. If pin counts exceed ~2000, cull to the visible world rect before considering
  `<canvas>`.
- **The trail is the one layer drawn in canvas space.** Every other world-space layer emits a group
  per map through `mapGroupStyle` and writes stored map-local coordinates verbatim. `TrailLayer`
  cannot: time crosses maps, so a segment joining two lines heard on two different images belongs to
  neither one's map-local space. Its single `<svg>` is a direct child of the world element, laid on
  `mapsBounds` with a `viewBox` carrying the same offset — which keeps canvas coordinates verbatim in
  `points`, so `src/map/trail-path.ts`'s `mapLocalToCanvas` call is still the only conversion in the
  feature. `--map-scale` is declared as `1` on `.map-canvas__world` itself, so the usual counter-scale
  expression stays valid outside a map group — which the trail needs, because
  **`vector-effect="non-scaling-stroke"` does not survive this app's transform chain.** It
  normalises against the nearest SVG viewport, and the canvas zoom is a CSS transform on an HTML
  ancestor *outside* every `<svg>` here, so the attribute never sees it: measured in Chromium, an
  otherwise identical probe stroke rendered 0.5px at zoom 0.25 and 16.5px at zoom 8, while
  `stroke-width: calc(2px / (var(--map-zoom) * var(--map-scale)))` held ~2px throughout. Reach for
  the `calc`, not the attribute, and do not "simplify" it back. And the trail is deliberately **not** culled against
  `visibleRect`: a segment whose two endpoints are both off screen can still cross the viewport, so
  culling would tear the line rather than save work.
- **World-space layers must stay viewport-independent.** `PinLayer` is `memo`'d and receives no prop
  derived from the `Viewport`, which is what keeps panning from re-rendering every pin. A layer that
  needs the current scale reads `--map-zoom` off its own computed style at `pointerdown` — passing a
  `scale` prop would change every frame and defeat the memo. Any future zone or overlay layer
  inherits this constraint. `MapCanvas` renders such layers via `children`, inside the world element.
  Transient state two layers must share — the live position of a map being dragged — belongs to
  `MapScreen`, which composes them: it feeds the same previewed `maps` array to both, and returns
  the document's own array identically when no drag is in flight so the memo still holds. A **pin**
  drag lifts its preview the same way (`PinDragPreview`, `onPinDrag`), but only `TrailLayer` reads
  it. `PinLayer` deliberately keeps receiving `project.dialogues`: it already renders the dragged pin
  from its own state, and a preview-patched array would be a fresh one every frame, rebuilding
  `groupByMap` and reconciling every pin. `TrailLayer` substitutes the vertex *after* `trailVertices`
  has sorted, so a `pointermove` never re-sorts the document.
- **Hash routing**, hand-rolled in `src/app/route.ts`, because Pages is static. The URL carries view
  state only, never data. The canvas is `#/canvas`, optionally `?dialogue=<id>` and
  `?focus=<mapId>`; the pre-M3.5 `#/map/<id>` still parses, dropping the id, so an old link lands
  on the canvas rather than rendering nothing. `focus` is a **one-shot intent, not view state**:
  the canvas jumps to that map once and clears the parameter with `navigate(..., { replace: true })`,
  because a persistent one would re-focus on every render and fight a user who panned away. Switching
  to history routing requires emitting `404.html` as a copy of `index.html`.
- **Dependencies.** Runtime deps stay `react` + `react-dom`. Evaluated and rejected: zustand/redux
  (the store is ~25 lines of platform API), react-router, `idb`, `zod`, `uuid`
  (`crypto.randomUUID()`), `date-fns` (`Intl.DateTimeFormat`), any charting library (inline SVG by
  hand), `@types/wicg-file-system-access` (conflicts with the interfaces `lib.dom` already ships).
  One tripwire: if `parseProjectFile` exceeds ~250 lines, or a second schema version forces
  per-version validation, `zod` becomes justified — nothing else on that list does. Measured at
  V7 (`src/project/data-file.ts` is ~990 lines total): the exported `parseProjectFile` function
  itself is still ~15 lines and delegates outright, and the file's size is the seven versions'
  worth of small, uniform `readVN`/`migrateVN` pairs sitting side by side, not one function that
  grew branches. Each new version has cost one new reader and one new migration function — V7's
  `migrateV6` is three lines — so the growth is linear and mechanical rather than the per-version
  branching the tripwire is actually about. `zod` is still not adopted.
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

Published to GitHub Pages at `https://tonsias.github.io/NPCanvas/` by
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
