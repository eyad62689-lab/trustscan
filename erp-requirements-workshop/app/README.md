# ورشة المتطلبات — app (v1)

Static, offline-first web app that runs a requirements workshop from the closed question bank (`bank-data/*.json`) and exports the requirements document as Word and Markdown with identical content. No server, no accounts, no analytics: all workshop data stays in the browser's `localStorage` and in files the facilitator exports.

Stack: Vite 6 + TypeScript + Preact 10. `docx` (Word export) is loaded lazily on first Word export. Tests: Vitest (node).

## Commands

```bash
npm ci
npm test                  # engine, export parity, progress-file security, validator, real-bank smoke
npm run validate          # validate bank-data/*.json (exit 1 on errors; unknown fields are reported, never fatal)
npm run validate:fixtures # same on test/fixtures
npm run dev               # local dev server
npm run build             # tsc + vite build + dist URL check (no external URLs)
npm run preview           # serve dist/ with the same CSP as netlify.toml
```

If `bank-data/` has no JSON at build time, the demo fixtures in `test/fixtures/` are bundled instead and the UI shows «بيانات تجريبية».

## Layout

- `src/engine/` — pure TypeScript, no DOM (unit-tested):
  - `load.ts` merge files, resolve `eqLabel/neLabel/inLabel/hasLabel/hasAnyLabel` to option keys, normalise template extensions, report unresolved labels and `{"text"}` conditions;
  - `compute.ts` flags, `module()`, fixed-point visibility, effective values («لا أعلم» → current recommendation), dynamic recommendations, list prefill (`rowsFrom`, row conditions, per-row `recommended`, `extraRows`, ROL-001 distribution), roles, conflicts (flag / show / note), auto flags (ق-ت9), archive set;
  - `slots.ts` template parser/renderer; `generate.ts` requirements, standard rules, assumptions, 4.7/4.8/4.9, out-of-scope, review gate; `doc.ts` → `docmodel.ts` → `export-md.ts` / `export-docx.ts`; `appendix.ts` YAML;
  - `progress.ts` progress file (SHA-256 checksum, strict validation, version migration); `storage.ts`; `time.ts`; `search.ts`; `workshop.ts` (mutations); `validate.ts` (used by the script).
- `src/ui/` — Preact components. `src/bank/source.ts` lazy-loads the bank JSON.
- `scripts/` — `validate-bank.mjs`, `check-dist-urls.mjs`, `sw-plugin.mjs` (generates `dist/sw.js`, cache-first precache of every emitted file).

## Bank contract and supported extensions

The app follows `BANK-SCHEMA.md`. On top of it, the loader understands (all optional):

| Where | Field | Meaning |
|---|---|---|
| Template | `forEach` (string or `{ref, where:[col,op,val]}`), `forEachRow`, `perRow`, `perItem` | one requirement per list/matrix row or per selected option; ids `<template>-01`, `-02`… (bank §٣.١ (٢)) |
| Template | `itemWhen` (with `@item.key` / `@item.<col>`), `rowFilter` `{ref, where}` | filter instances / filter rows joined by `{{Q:QID#part.col}}` |
| Template | `alternativeOf` | the alternative replaces the original when its `when` holds |
| Template | `family`, `sourceTemplate`, `expandedFrom` | pre-expanded instances are numbered `<family>-NN` |
| Template | `priority {value, when}`, `priorityText`, `priorityIf` | requirement priority override (key or label) |
| Template | `source: "نص حر"`, id containing `R9nn` | free-text requirement, numbered `XXX-R901…` |
| Template | `x` id suffix without iteration | iteration is inferred from `{{Q:<same QID>#part.col}}` (reported as a warning) |
| Slots | `{{ITEM}}`, `{{ITEM:attr}}`/`{{ITEM.attr}}`, `{{ITEMCELL:QID#part.col}}`, `{{Q:QID#part[row].col}}`, `{{Q:QID#part.row.col}}`, `{{Q:QID#part[row]._label}}`, `{{Q:QID#main.other}}`, `{{Q:QID#main.<opt>_priority}}` | item / cell / other-text / option-priority values |
| Slots | `{{IF:<json>|text}}` | JSON parsed by brace matching (may contain `}}`); nested slots allowed in IF/SW branches |
| Text | single-brace `{GEN-001}` | rendered as the answer when resolvable, else kept verbatim |
| Part | `optionsFrom`, `rowsFrom`, `rowsFromColumn`, `rowsExclude`, `rowsFromCondition`, `fixedRows`/`rowsFixed`, `extraRows {when,row}`, `rangeFrom`, `distribution`, `inputType: "time"`, `conditionLabel` | dynamic options/rows and UI hints |
| Column | `condition`, `optionsFrom`, `rowsFrom`, `readOnly`, `multiple`, type `role`/`branch`/`bool` | role cells hold ROL-001 role keys (arrays when `multiple`); dynamic recipients per `KEYS-ROLES.md` |
| Option | `condition`, `exclusive`, `deferred`, `module`, `desc`, `hint` | |
| Recommended | `when[].rowsFrom` (placeholder rows like «<اسم الفرع>» expanded per source row), `columnDefaults`, `rowDefault`, multiPriority `{key:null}` (= unit priority) | |
| Section | `contains` (→ `alsoIn`), `opening.notice`, `autoAdded` | meta.json is authoritative for id/title/order/condition/kind |
| Question | `alsoIn`, `workshopNote`, `reviewDate`, `flagOnDontKnow` | |
| Refs | ids with Arabic letters and dots (`PRF-003.ب`); Arabic part names (`GEN-002#العملات`) are matched to part labels | references to deferred-unit questions (POS-…, HR-…, CRM-…) evaluate false/empty |
| meta.json | `scopeQuestion`, `rolesQuestion`, `branchesQuestion`, `dynamicRecipients`, `singleUserLabel`, `multiUserFlag`, `regulatoryReviewDate`, `dontKnowFlagQuestions`, `roleAliases` | optional; defaults: SCP-001, ROL-001, GEN-003, KEYS-ROLES recipients, «المستخدم الوحيد», F_MULTIUSER, `meta.date`, PRF descriptive + TAX-001/TAX-002, {البائع→موظف المبيعات، المدير→المدير العام} |

`{"text": …}` conditions are treated as **true** and listed by `npm run validate`. When such a condition is part of a *flag* conflict, the flag text says the textual part must be checked by hand.

`export.json` is read through a tolerant normaliser (`src/engine/export-spec.ts`): `chapters` (titles, `units.prf003bChapterOrder`, `units.taxSoonHeading`, `assumptions.reasons`), `fixedTexts` (incl. `outOfScopeLines`, `privacyNotice`, `missingSlotFlag`…), `row47` (`variants[].if` → ruling/phase/note/outOfScope), `items48`, `setup49 {a,b}`, `workshop.facilitatorGuide`. Unrecognised top-level keys are reported, not fatal.

## Security / privacy

- `netlify.toml`: strict CSP (`default-src 'self'`, no inline scripts/styles, `object-src 'none'`, `frame-ancestors 'none'`…), `nosniff`, `no-referrer`, COOP/CORP, Permissions-Policy, HSTS; `index.html` and `sw.js` are `no-cache`, `/assets/*` immutable. `vite preview` sends the same CSP.
- No `innerHTML`/`eval` anywhere; bank and user text is rendered as text. Markdown export escapes markup characters.
- Progress files are untrusted input: ≤ 10 MB, JSON only, `format`/`formatVersion` check, SHA-256 checksum over the canonical workshop JSON, deep scan rejecting `__proto__`/`constructor`/`prototype` keys, functions, non-finite numbers, over-long strings and non-PNG/JPEG data URLs, then a field-by-field shape validation. The checksum detects corruption and naive edits; it is not a signature.
- `npm run build` fails the URL check only with `--strict`; the current dist contains only XML namespace identifiers (written into .docx, never requested) and library documentation links in comments.

## Deploy

Netlify project `erp-requirements-workshop` (team `eyad62689`), connected to the `eyad62689-lab/trustscan` repository with base directory `erp-requirements-workshop/app`; `netlify.toml` builds with `npm ci && npm run build` (Node 22) and publishes `dist`. Step-by-step procedure, checks and troubleshooting: `../DEPLOY.md`.
