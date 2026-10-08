# Bank data contract (bank 2.5 → JSON)

The app is fully data-driven (NFR-11): every question, option, condition, recommended answer, requirement template, standard rule and conflict rule lives in `app/bank-data/*.json`. The app code never hard-codes bank content. Source of truth for content: `content/question-bank/*.md` (bank 2.5). Arabic text is copied verbatim (minus provenance tags `〔مصدر: …〕`, which are dropped).

## Files
| File | Content | Producer |
|---|---|---|
| `meta.json` | bank version, glossary, flags, sections order, branching rules (ق-ت…), generator rules | part 00 |
| `prf-scp.json` | PRF + SCP questions (+ ROL-001 is in shared) | part 00 |
| `rules-general.json` | STD-GEN-01..72 and general conflict rules تع-01..41 | part 01 |
| `acc.json`, `sal.json`, `tax.json`, `pur.json`, `inv.json`, `exp.json`, `trs.json` | unit questions + unit STD rules + unit conflict rules | parts 10–16 |
| `shared-a.json` (GEN, ROL, DOC, RPT), `shared-b.json` (ALR, INT, MIG, ADM) | shared-section questions | part 20 |
| `deferred.json` | deferred units: id, title, order only (no questions in v1) | part 80 |
| `export.json` | exported-document structure (90 §8.3): chapters, fixed texts, 4.7 rows, 4.8 items, 4.9 setup rows (with conditions), YAML key names | part 90 |

Every file is a single JSON object. Unit files: `{ "unit": "SAL", "sections": [Section], "questions": [Question], "rules": [Rule], "conflicts": [Conflict] }`.

## Expressions (`Expr`) — JSON tree, never free text
```
true | false
{"flag": "F_VAT"}                       derived flag (meta.json defines each flag as an Expr)
{"module": "SAL"}                       M(SAL): unit selected in SCP-001 or auto-added; deferred units → false
{"eq": ["SAL-008", "credit_block"]}     single-choice part equals option key   (ref = "QID" or "QID#part")
{"ne": ["PRF-004", "one_person"]}
{"in": ["ACC-007", ["monthly_lock","monthly_acct"]]}
{"has": ["SAL-001", "credit"]}          multi-choice includes option key
{"hasAny": ["PRF-010", ["companies","gov"]]}
{"num": ["PRF-004#b", ">=", 2]}         numeric compare: > >= < <= == !=
{"answered": "SAL-008"}                 has a non-empty answer
{"visible": "ACC-009#b"}                question/part currently visible
{"rowsAny": ["TRS-002", "branch", "!=", ""]}   repeated list: any row matches (rarely needed)
{"all": [Expr, ...]}  {"any": [Expr, ...]}  {"not": Expr}
```
Refs: `"QID"` = the question's first/main part; `"QID#key"` = a named part. «لا أعلم» is replaced by the recommended value before evaluation (bank rule 4.1). If a condition genuinely cannot be expressed, use `{"text": "<original Arabic>"}` — the app treats it as **true** and lists it in a build-time report (keep these to a minimum).

## Question
```json
{
  "id": "SAL-008",
  "section": "SAL",               // section id it is displayed in (unit code or mini-section id)
  "order": 8,                     // display order within section
  "title": "كيف يُضبط البيع الآجل لكل عميل؟",
  "help": "حد الائتمان هو …",      // «توضيح للمستخدم»
  "detail": false,                // true = تفصيلي (appears only when triggered by a previous answer)
  "condition": Expr,              // شرط الظهور (null = always when its section is visible)
  "conditionText": "…",           // original Arabic, for audit
  "regulatory": false,            // true if the question touches a regulation / has [يحتاج تحقق]
  "verify": ["…"],                // [يحتاج تحقق] items attached to this question (Arabic text)
  "impact": "…",                  // «أثره على البناء» (Arabic, verbatim)
  "parts": [Part],                // at least one
  "templates": [Template],
  "workshopNote": null            // optional facilitator hint
}
```

## Part (one answer field; most questions have exactly one, key "main")
```json
{
  "key": "main",                  // "main", or "b", "c", "approver", … (Latin, stable)
  "label": "…",                   // Arabic label shown above the field (may be "" for main)
  "type": "single" | "multi" | "multiPriority" | "number" | "text" | "longtext" | "list" | "matrix" | "logo" | "approvalRow",
  "options": [ {"key": "credit_block", "label": "حد لكل عميل يمنع البيع عند تجاوزه إلا باعتماد", "other": false, "dontKnow": false} ],
  "max": null,                    // multi: optional max selections
  "unit": null,                   // number: Arabic unit label (أيام، ساعة، {GEN-001} …)
  "min": null, "maxValue": null,
  "columns": [Column],            // list / matrix columns
  "rows": [ {"…": "…"} ],         // list: prefilled rows (keys = column keys); matrix: row labels as [{"key","label"}]
  "rowsFrom": null,               // list/matrix: dynamic rows source, e.g. "ROL-001" (roles), "SCP-001" (selected units), "GEN-003" (branches)
  "condition": Expr,              // part-level visibility (e.g. approval row only when credit_block)
  "recommended": Recommended,
  "required": false
}
```
Option rules: every option gets a stable lowercase English snake_case `key` unique within the part. «أخرى (حدّد)» → `{"key":"other","other":true}` (app shows a text box). «لا أعلم» → `{"key":"dont_know","dontKnow":true}`. Keep Arabic labels verbatim.

Column: `{"key":"days","label":"عدد الأيام","type":"text|number|single|multi|role|branch|bool","options":[…]}`. Type `role` = dropdown from ROL-001 roles + dynamic recipients; `branch` = from GEN-003 branches.

`approvalRow` (pattern م-8): a fixed set of columns {approver (role), on_reject (single), reminder_hours (number)} — represent it as `type:"approvalRow"` with `columns` filled.

## Recommended
```json
{
  "value": "credit_block",        // single: key; multi: [keys]; number: n; text: "…"; list: [rows]; matrix: {row:{col:val}}
  "reason": "أكثر ما يُفقد المال …",
  "when": [ {"if": Expr, "value": …, "reason": "…"} ],   // dynamic recommendations (FR-05), first match wins, else value
  "text": "original Arabic recommended line"            // verbatim, for audit/tooltips
}
```
If the bank recommends something not expressible as a value (e.g. "the row's own…"), put the best value plus `"text"`.

## Template (قالب الصياغة)
```json
{
  "id": "SAL-R008",
  "when": Expr,                   // generation condition ("يُولَّد عند …"); null = whenever the question is visible & answered
  "noRequirement": false,         // true for «لا يولّد متطلباً — السبب: …» rows (text = the reason)
  "text": "يجب أن يمنع النظام إصدار فاتورة آجلة … {{Q:GEN-013#a}} … {{Q:SAL-008#approver}} …"
}
```
Slot syntax inside `text` (normalise the bank's `{…}` slots to these):
- `{{Q:QID}}` / `{{Q:QID#part}}` → the answer's Arabic label(s) (multi → joined with «، »; list → rows rendered «a (b)، c (d)»).
- `{{Q:QID#part.col}}` → for a list part: that column joined across rows.
- `{{SW:QID#part|key1=نص|key2=نص|*=نص}}` → switch on the selected option key; `*` = default. Nested `{{Q:…}}` allowed inside the branch texts. Multi parts: concatenates the texts of every selected key with «؛ ».
- `{{R:STD-SAL-18}}` → a reference to a standard rule id (rendered as the id).
- Anything the template needs that has no source → leave as `{{MISSING:description}}`; the app turns it into a «يحتاج حسماً» flag (FR-16).

## Section
```json
{ "id": "SAL", "title": "المبيعات والفوترة", "order": 30, "condition": Expr, "kind": "unit|shared|profile|scope|roles|mini",
  "opening": {"attendees": "…", "mandatory": ["…"], "duration": "…", "minutes": 45, "discussion": ["…","…"]} }
```
Mini-sections (ق-ت11 «تسجيل المصروفات البسيط», ق-ت12 «الصناديق والحسابات البنكية», «الأدوار» = ROL-001 after SCP) are sections with `kind:"mini"` whose `condition` encodes the rule; the questions they contain are listed with `"alsoIn": ["EXP-MINI"]` on the question.

## Rule (standard rule STD-*)
```json
{ "id": "STD-SAL-04", "scope": "SAL", "title": "…", "text": "Arabic full text (sub-items kept, numbered)", "applies": Expr, "appliesText": "…", "regulatory": false }
```
`applies` = when the rule is in force for this entity (null = always when its unit is selected). Rules whose items depend on hidden paths keep their text; STD-GEN-65/69/71 dropping is applied by the app at render time only where marked with `{{IF:Expr|text}}` — use `{{IF:{"flag":"F_VAT"}|…}}` around clauses that must disappear for non-tax-ready entities when the bank says so.

## Conflict (تع-…)
```json
{ "id": "تع-03", "scope": "SAL", "condition": Expr, "action": "flag" | "show" | "note", "target": "SAL-022", "text": "نص التعارض/الحكم كما في البنك" }
```
`flag` = raise «يحتاج حسماً» automatically with `text`; `show` = make `target` question visible; `note` = rule applied automatically, written into the document (no flag).

## meta.json
```json
{ "bankVersion": "2.5", "date": "2026-10-08",
  "flags": [ {"id": "F_VAT", "expr": Expr, "text": "…"} ],
  "sections": [Section],                  // global order of all sections incl. PRF, SCP, ROLES, units, shared
  "branching": [ {"id": "ق-ت2", "text": "…", "expr": Expr|null} ],
  "glossary": [ {"term": "…", "meaning": "…", "avoid": "…"} ],
  "generatorRules": [ {"id": "ع-01", "text": "…"} ],
  "durations": {"…": "…"} }
```

## Validation (run `node app/scripts/validate-bank.mjs`)
Every Expr references existing question ids/parts/option keys/flags/units; every template slot references existing refs/options; ids unique across files; no `〔مصدر` left in text.
