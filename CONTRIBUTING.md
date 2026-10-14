# Contributing to Graphics

Thanks for contributing! This guide covers the **workflow** for contributing and the **coding standards** that keep Graphics consistent.

## Development Setup

```bash
pnpm install                                # install dependencies
pnpm build                                  # build all packages
pnpm dev                                    # watch-build all packages
pnpm test                                   # test all packages
pnpm check                                  # lint, format & type check
cd packages/<pkg> && pnpm build             # build one package
cd packages/<pkg> && pnpm dev               # watch-build one package
```

Prerequisites: Node.js 20+, pnpm 10. The browser playground lives in `playground/browser` and serves `127.0.0.1:5173` against the workspace `unimage`.

## Contribution Workflow

1. **Fork & clone** — fork on GitHub, clone your fork, add `upstream` (`git remote add upstream https://github.com/bysages/graphics.git`).
2. **Branch** — branch off `main` (`codex/...`, `feat/...`, `fix/...`, `docs/...`).
3. **Code** — follow the standards below; match existing style.
4. **Commit** — use [conventional commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, `perf:`, `test:`, `build:`, `ci:`, `chore:`, `revert:`. Commit messages state what changed and why, in the imperative mood, with no AI attribution.
5. **Push & PR** — push to your fork and open a PR against `upstream/main`. Keep diffs surgical: every changed line traces to the task, and `pnpm check` plus `pnpm test` pass before review.

## Project Structure

| Path                 | Purpose                                                       |
| -------------------- | ------------------------------------------------------------- |
| `packages/unimage`   | Image recipe contract, drivers, and the IPX-compatible server |
| `packages/unpalette` | Palette extraction, generation, quantization, remapping       |
| `playground/browser` | Vue playground against the workspace `unimage`                |

## Coding Standards

### Naming

- **Files & modules**: one word wherever the module name itself provides context — `median.ts` exporting `cut`, `filters.ts`, `drivers/napi.ts`; hyphens only when the concept genuinely needs two words
- **Functions**: one word inside a module (`distance`, `nearest`, `sample`, `cut`); public APIs that leave the package stay self-describing (`extractPalette`, `applyPalette`)
- **Exports**: each package exports its minimal surface; internal helpers stay internal
- **Types**: PascalCase, no `I` prefix, `Options` suffix for option bags

### Errors

- Core throws `UnImageError` with a closed `code` union; server-side code throws h3's `HTTPError` directly — never define a parallel HTTP error type

### Dependencies

- Package cores stay lean: engines (`sharp`, `@napi-rs/image`, `svgo`) and integrations (`unstorage`) are optional peer dependencies
- IO belongs in explicit drivers; storage delegates to unstorage

## PR Checklist

- [ ] `pnpm check` passes with no warnings
- [ ] `pnpm test` passes
- [ ] New behavior has tests
- [ ] README documents any public API change
- [ ] No temporary files, debug prints, or internal notes in the diff
