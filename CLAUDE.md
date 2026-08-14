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

## Commands

```bash
npm run dev      # Vite dev server (base '/', http://localhost:5173)
npm run build    # tsc -b (typecheck, project references) then vite build -> dist/
npm run preview  # serve dist/ locally; served under /NPCanvas/
npm run lint     # eslint (flat config)
```

No test runner is configured. If tests become worthwhile, add Vitest (shares Vite's config and
transform pipeline) and wire it into `.github/workflows/deploy.yml` before the build step.

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
