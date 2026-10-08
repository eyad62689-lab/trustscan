# KEYS-SHARED — option keys for PRF-* / SCP-*, flag ids, section ids (bank 2.6, part 00)

Producer: part 00 extractor. Use these keys in Expr (`eq`/`has`/`in`…) in other unit files. Source of truth: app/bank-data/prf-scp.json and meta.json.


Question ids are verbatim, incl. `PRF-003.ب`, `PRF-004.ب` (separate question blocks in the bank → separate questions).

| Question | Part | Key | Arabic label |
|---|---|---|---|
| PRF-001 | main (text) | — | — |
| PRF-002 | main | sole_proprietorship | منشأة فردية (مؤسسة) |
| | | company | شركة |
| | | nonprofit | جهة غير ربحية أو جمعية |
| | | other | أخرى (حدّد) |
| | | dont_know | لا أعلم |
| PRF-003 | main | vat_registered | مسجّل في ضريبة القيمة المضافة |
| | | not_registered_no_plan | غير مسجّل، ولا نتوقع التسجيل |
| | | not_registered_expected | غير مسجّل، ونتوقع التسجيل لاحقاً |
| | | dont_know | لا أعلم |
| PRF-003.ب | main | yes / no / dont_know | نعم / لا / لا أعلم |
| PRF-003.ب | approach_pct (number, ٪; setup value, rec. 80, visible when main=yes) | — | نسبة الاقتراب |
| PRF-004 | main | one_person | شخص واحد |
| | | users_2_5 | 2–5 |
| | | users_6_20 | 6–20 |
| | | users_21_50 | 21–50 |
| | | users_50_plus | أكثر من 50 |
| | | dont_know | لا أعلم |
| PRF-004.ب | main (number) | — | (rec. 2/6/21/51 by PRF-004) |
| PRF-005 | main | one_site | موقع واحد |
| | | sites_2_3 | 2–3 |
| | | sites_4_10 | 4–10 |
| | | sites_10_plus | أكثر من 10 |
| | | dont_know | لا أعلم |
| PRF-006 | main (multi) | trade | تجارة (بيع بضاعة جملة أو تجزئة) |
| | | services | خدمات |
| | | contracting | مقاولات أو مشاريع بعقود |
| | | other / dont_know | |
| PRF-007 | main | yes / no / dont_know | نعم / لا / لا أعلم |
| PRF-008 | main | none | لا يوجد موظفون |
| | | emp_1_5 | 1–5 |
| | | emp_6_20 | 6–20 |
| | | emp_21_50 | 21–50 |
| | | emp_51_200 | 51–200 |
| | | emp_200_plus | أكثر من 200 |
| | | dont_know | لا أعلم |
| PRF-009 | main (multi) | paper | دفاتر وأوراق |
| | | excel | جداول إكسل |
| | | software | برنامج محاسبي أو إداري حالي |
| | | mobile_apps | تطبيقات متفرقة على الجوال |
| | | no_records | لا يوجد تسجيل منتظم |
| | | other / dont_know | |
| PRF-010 | main (multi) | individuals | أفراد (المستهلكون) |
| | | companies | منشآت وشركات |
| | | government | جهات حكومية |
| | | dont_know | لا أعلم |
| PRF-011 | main (multi, max 3) | true_profit | معرفة الربح الحقيقي |
| | | inventory_control | ضبط المخزون ومنع الفقد |
| | | expense_control | ضبط المصروفات |
| | | debt_collection | تحصيل الديون من العملاء |
| | | tax_compliance | الالتزام الضريبي والنظامي |
| | | payroll_attendance | ضبط الرواتب والحضور |
| | | customer_sales | متابعة العملاء والمبيعات |
| | | planning_budget | التخطيط والموازنة |
| | | less_manual | تقليل العمل اليدوي |
| | | other / dont_know | |
| PRF-012 | main | single_entity | كيان واحد |
| | | multi_entity | عدة كيانات تُدار معاً |
| | | dont_know | لا أعلم |
| PRF-013 | main (list) cols | entity_name (text) / vat_registered (bool) / shares_master (bool) | اسم الكيان / مسجّل في الضريبة / يشارك العملاء والأصناف مع غيره |
| PRF-013 | consolidated (single) | yes / no | تقارير مجمّعة لكل الكيانات: نعم / لا |
| PRF-099 | main (longtext) | — | — |
| SCP-001 | main (multiPriority) | acc, sal, pur, inv, exp, trs | core units (module ACC…TRS) |
| | | pos, fas, hr, pay, att, crm, prj, bud | deferred units, option `deferred:true` |
| | | other / dont_know | أخرى (حدّد) / لا أعلم |
| SCP-001 | priority values | must_day_one / later_phase / nice_to_have | ضروري من اليوم الأول / مرحلة لاحقة / مستحسن إن أمكن |
| SCP-002 | main | one_go | دفعة واحدة |
| | | phased | على مراحل بحسب الأولويات المحددة |
| | | dont_know | لا أعلم |
| SCP-003 | main | yes_simplified_acc | نعم، أضيفوا المحاسبة العامة بشكلها المبسّط |
| | | no_ops_only | لا، يكفينا تسجيل العمليات وتقاريرها |
| | | dont_know | لا أعلم |
| SCP-099 | main (longtext) | — | — |

SCP-001 options carry extra fields: `module` ("ACC"…), `desc`, `hint`, `condition` (index visibility: F_BIZ; POS/INV +F_STOCK; HR/PAY/ATT +F_EMP), `deferred`. multiPriority recommended value = object `{optionKey: priorityKey}`.

Flags: F_PERSONAL(false, dropped), F_BIZ(true), F_VAT, F_VAT_SOON, F_TAXREADY, F_MULTIUSER, F_MULTIBRANCH, F_STOCK, F_EMP, F_EMP_MID, F_MULTIENTITY, F_CONTRACT, F_B2B, F_B2C, F_MIGRATE.
Section ids: PRF, SCP, ROLES, GEN, ACC, SAL, TAX, PUR, INV, EXP-MINI, EXP, TRS-MINI, TRS, ROL, DOC, RPT, ALR, INT, MIG, ADM.


## Flag expressions (meta.json)
- F_PERSONAL=false; F_BIZ=true
- F_VAT={eq:[PRF-003,vat_registered]}; F_VAT_SOON={eq:[PRF-003,not_registered_expected]}; F_TAXREADY=any(flag F_VAT, flag F_VAT_SOON)
- F_MULTIUSER={ne:[PRF-004,one_person]}; F_MULTIBRANCH={ne:[PRF-005,one_site]}; F_STOCK={eq:[PRF-007,yes]}
- F_EMP={ne:[PRF-008,none]}; F_EMP_MID={in:[PRF-008,[emp_6_20,emp_21_50,emp_51_200,emp_200_plus]]}
- F_MULTIENTITY={eq:[PRF-012,multi_entity]}; F_CONTRACT={has:[PRF-006,contracting]}
- F_B2B={hasAny:[PRF-010,[companies,government]]}; F_B2C={has:[PRF-010,individuals]}
- F_MIGRATE={hasAny:[PRF-009,[paper,excel,software,mobile_apps,other]]} (= «لا تساوي لا يوجد تسجيل منتظم»; dont_know→rec. excel)

