# Brief — confirmatory NFR-13 run on unified bank 2.4 (launch condition)

You are an INDEPENDENT reviewer who wrote none of the bank. Adversarial: find every business question a coding agent would still have to ask the client.

Root: /home/user/trustscan/erp-requirements-workshop (Arabic; write in Arabic).
**The bank is ONLY `content/question-bank/*.md`** (00-foundations, 01-global-rules, 10-acc, 11-sal, 12-tax, 13-pur, 14-inv, 15-exp, 16-trs, 20-shared, 90-workshop-and-export; 80-deferred is out of scope). Do NOT read the old closure files `content/bank-closure-*.md`, `erp-requirements-idea-doc.md`, or any `evidence/` file — bank 2.4 must stand alone (CHANGELOG-2.1.md … CHANGELOG-2.4.md in that folder are part of the bank). Personas: `content/reference-personas-and-scan-lists.md` (v1.3). Decisions/NFR-13: `03-handoff-brief-v1.0.md` §٧ and §١٣.

Method (as before): derive flags and visible questions per persona; explicit persona answers = «إجابة»; unspecified visible questions = their «الموصى به» («إجابة»); «لا أعلم» = recommended as «افتراض». Generate the exported-document chapters for your scope exactly per 90 §8.3, filling every template slot from answers/recommended/standard rules; every requirement row sourced (إجابة / افتراض / قياسي). Tag anything unsourced inline and do not guess.
Gap classes: (أ) missing numeric value; (ب) business decision not asked/decided; (ج) unresolved conflict; (د) ambiguity (incl. dangling ID/slot references, cross-part contradictions). Pass bar per persona per unit: ب+ج+د = 0 and أ ≤ 2 (all in the assumptions register).
Also: grep checks on the bank — NFR-07 forbidden terms (whole-word with attached prefixes و ف ب ل ك, per the scan-list method), NFR-08 vendor names/prices, regulatory numbers without [يحتاج تحقق].
For each gap: ID (C2-<persona>-<UNIT>-nn), class, location (part file + IDs), the question the implementer would ask, and a proposed ready-to-paste fix for bank 2.4 (state the part file and exact place; new IDs: after the current highest (STD-GEN-72, تع-41, ق ع-112, STD-PUR-11, setup row ب-٣٣, unit STD numbers) — grep first).
Output a final pass/fail table per unit × class. Write only your output file. Final message: counts table + all blocking gaps in one line each.

---
## Editor brief (after the four reports arrive)
Raise the bank to the next version (2.x): (1) write `content/question-bank/CHANGELOG-2.x.md` first — deduplicated ledger «ت2x-nn / gaps closed / part + location / summary»; reports propose clashing IDs, so assign final unique IDs after grepping; (2) apply every change in the part files, tagged `〔مصدر: 2.x — ت2x-nn〕`, resolving ALL blocking gaps AND ALL non-blocking notes; (3) new business choices → «قرارات بصلاحية المخطط (2.x)» in the changelog AND as «حي» rows in `decisions-for-owner-review-v1.1.md` (update counts); (4) business level only, no regulatory numbers without [يحتاج تحقق], glossary/NFR-07 whole-word/NFR-08 clean; grep every new/changed ID so nothing dangles; update «جرد الدمج» counts and the version in the 00 header and 90 (cover line, YAML); (5) update the convergence table and launch-condition status in README, 03 §١١/§١٤, 02, and add rows to decision-log.md.

Run layout per round: four independent agents in parallel — ش١ fin (ACC, TAX, EXP, TRS), ش١ core (SAL, PUR, INV + shared + PRF/SCP), ش٢ fin (ACC, EXP, TRS + non-registered TAX path), ش٢ core (SAL, PUR, INV + shared + PRF/SCP); outputs `evidence/confirm-v2.x-{p1-fin,p1-core,p2-fin,p2-core}.md`. Commit and push each report as it arrives.
