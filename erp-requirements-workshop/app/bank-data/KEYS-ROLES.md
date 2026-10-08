# KEYS-ROLES — role keys, capacities, dynamic recipients (bank 2.6, part 20 / ROL-001)

Producer: part 20 extractor (shared-a.json). Source of truth: `app/bank-data/shared-a.json` → question `ROL-001`, part `main`, `rows[].key`.

Use these keys wherever a bank answer, recommended value, column of type `role`, or Expr names a role.
Value form: a plain key string, e.g. `"owner"`, or an array `["owner","accountant"]` for multi-role cells.

## Role keys (ROL-001 prefilled rows)

Each row in ROL-001 `main.rows` carries `key` (below), `condition` (generation condition as Expr) and the column values (`name`, `description`, `users`, `branch`, `capacity`).

| key | Arabic (ROL-001 «اسم الدور») | generated when (bank) | Expr in shared-a.json | branch (rec.) |
|---|---|---|---|---|
| `owner` | المالك | دائماً | `true` | all_branches |
| `accountant` | المحاسب | ACC أو EXP أو TRS أو TAX، أو أحد القسمين المصغّرين ق-ت11 / ق-ت12 | `any[M(ACC),M(EXP),M(TRS),M(TAX), all[any[M(ACC),M(SAL),M(POS),M(PUR)],not M(EXP)], all[any[M(SAL),M(POS),M(PUR),M(EXP),M(PAY)],not M(TRS)]]` | all_branches |
| `general_manager` | المدير العام | `F_MULTIUSER` وPRF-004 ∉ {«2–5»} | `all[flag F_MULTIUSER, not eq[PRF-004,users_2_5]]` | all_branches |
| `sales_employee` | موظف المبيعات | SAL | `module SAL` | specific_branch |
| `sales_rep` | مندوب المبيعات | SAL، ويُحذف عند SAL-013 = «لا مندوبين» أو خفائه | `all[module SAL, visible SAL-013, not eqLabel[SAL-013,«لا مندوبين»]]` | all_branches |
| `cashier` | الكاشير | POS (deferred → false in v1) | `module POS` | specific_branch |
| `store_supervisor` | مشرف المحل | POS (deferred) | `module POS` | specific_branch |
| `purchasing_officer` | مسؤول المشتريات | PUR | `module PUR` | all_branches; specific_branch when PUR-013 = «كل فرع يشتري لنفسه» |
| `storekeeper` | أمين المستودع | INV | `module INV` | specific_branch |
| `hr_officer` | مسؤول الموارد البشرية | HR أو PAY أو ATT (deferred) | `any[M(HR),M(PAY),M(ATT)]` | all_branches |
| `branch_manager` | مدير الفرع | `F_MULTIBRANCH` | `flag F_MULTIBRANCH` | specific_branch |
| `project_manager` | مدير المشروع | PRJ (deferred) | `module PRJ` | all_branches |
| `sales_manager` | مدير المبيعات | CRM (deferred) | `module CRM` | all_branches |
| `employee_self_service` | الموظف (خدمة ذاتية) | HR-007 ≠ «لا شيء» (deferred) | `all[visible HR-007, not hasLabel[HR-007,«لا شيء (كل شيء عبر الموارد البشرية)»]]` | all_branches |
| `external_auditor` | المراجع الخارجي | ACC-012 = «نعم» | `eqLabel[ACC-012,«نعم، دخول للاطلاع فقط خلال فترة المراجعة»]` | all_branches |
| `driver` | السائق | SAL-026 = «السائق يحدّث الحالة بنفسه» | `eqLabel[SAL-026,«السائق يحدّث الحالة بنفسه (يُضاف دور «السائق» إلى ROL-001)»]` | specific_branch |

Ordering of rows in ROL-001 = table order above (bank listing order, with المدير العام moved after المحاسب to match the distribution order «المالك ← المحاسب ← المدير العام ← …»).
Distribution order for the users column (ROL-001 قاعدة التوزيع (٤)): owner → accountant → general_manager → sales_employee → storekeeper → purchasing_officer → branch_manager → sales_rep → driver → rest in row order. Encoded in `ROL-001.main.distribution.order`.

Not a role key: «الفني» (technician) is a non-user person (STD-GEN-20, SAL-031.ب, DOC-006) — never a value of a `role` column.

## Capacities (ROL-001 column `capacity`, multi; empty by default)

| key | Arabic | rule |
|---|---|---|
| `cashbox_officer` | مسؤول الصندوق | STD-GEN-27 (٣) |
| `custody_holder` | حامل عهدة | STD-GEN-27 (٣) |
| `branch_cashier` | أمين صندوق الفرع | STD-TRS-13 |

## Dynamic recipients (ع-04) — valid values in any `role` column besides ROL-001 rows

| key | Arabic |
|---|---|
| `document_creator` | مُنشئ المستند |
| `approver_concerned` | المعتمِد المعني |
| `custody_holder` | حامل العهدة |
| `cashbox_officer` | مسؤول الصندوق |
| `branch_cashier` | أمين صندوق الفرع |
| `sole_user` | المستخدم الوحيد (pseudo-recipient when not `F_MULTIUSER`, ق-ت5 / STD-GEN-01) |

(`custody_holder`, `cashbox_officer`, `branch_cashier` are the same keys as the capacities: as a recipient they mean «whoever holds that capacity for the document's box/custody».)

## Other keys defined in shared-a.json that other units may reference

| Question | Part | Keys |
|---|---|---|
| GEN-001 | main | `sar` / `other` / `dont_know` |
| GEN-002 | main | `no` / `yes` / `dont_know`; part `currencies` (list, col `currency`); part `rate_method`: `manual_daily` / `per_transaction` |
| GEN-002.ج | main | `purchase` / `sale` / `bank_accounts` / `dont_know` |
| GEN-003 | main (list) | cols `name`, `city`, `type` (`head_office` / `sales_branch` / `warehouse_only` / `office`), `opening_date` |
| GEN-004 | main | `jan_1` / `other_month` (other) / `dont_know` |
| GEN-005 | main | `gregorian_only` / `gregorian_with_hijri` / `hijri_primary` / `dont_know` |
| GEN-006 | main | `sat` `sun` `mon` `tue` `wed` `thu` `fri` / `dont_know` |
| GEN-007 | main | `arabic_only` / `arabic_english_user_choice` / `dont_know` |
| GEN-008 | main (multiPriority) | `desktop` / `mobile` / `tablet` / `dont_know` |
| GEN-008.ب | main | `approvals` / `alerts_daily_summary` / `dashboard` / `customer_statement_stock` / `field_quote_invoice_receipt` / `expense_receipt_photo` / `delivery_status` / `cash_remittance` / `stock_count` / `dont_know` |
| GEN-009 | main | `office_only` / `anywhere` / `mixed_by_role` / `dont_know` |
| GEN-009.ب | main (multi of role keys, `optionsFrom: "ROL-001"`) | role keys + `custody_holder` |
| GEN-010 | `users` | `same` / `double` / `more_than_double`; `branches`: `same` / `plus_1_2` / `more` |
| GEN-011 | number parts | `sales_invoices`, `purchase_invoices`, `items`, `customers`, `suppliers` |
| GEN-012 | main | `western_digits` / `arabic_indic_digits` / `dont_know` |
| GEN-013 | `a` | `incl_vat` / `excl_vat` / `dont_know`; `b`: `doc_rate` / `monthly_rate` / `dont_know` |
| ROL-002 | main (matrix rows = roles, cols `sal` `pur` `inv` `acc` `exp` `trs` `tax`) | cell actions: `view` / `create` / `edit` / `approve` / `delete_cancel` / `none` |
| ROL-003 | main (list) | col `role`; col `scope`: `all_data` / `own_branch` / `own_records` / `dont_know` |
| ROL-004 | main (list, fixed rows) | row keys `cost_margin`, `payroll_personal`, `bank_cash_balances`, `profit_loss`, `customer_full_data`, `individual_salary_entries`; col `roles` |
| ROL-005 | main | `yes_always` / `yes_except_owner` / `no` / `dont_know`; part `creator_fallback`: `next_level` / `owner_direct` |
| ROL-006 | main | `delegate` / `auto_escalate` / `wait` / `dont_know` |
| ROL-007 | main | `yes` / `no` / `dont_know` |
| ROL-008 | main (list, fixed rows) | row keys `customer_credit_limit`, `customer_payment_terms`, `customer_category`, `customer_price_list`, `responsible_sales_rep`, `selling_prices`, `supplier_payment_terms`, `supplier_iban`; cols `item`, `record`, `roles`, `owner_approval` |
| DOC-001 | main | `logo` `name_ar` `name_en` `cr_number` `vat_number` `address` `phone` `email` `website` `bank_details` `terms` / `other` / `dont_know`; part `logo_file` (logo) |
| DOC-002 | main | `arabic_only` / `bilingual_same_doc` / `user_choice_at_print` / `dont_know` |
| DOC-003 | main (list) | cols `unit`, `document`, `print_send` (`print_send` / `print` / `no`), `print_note`, `size` (`a4` / `a5` / `thermal`), `signatures`, `stamp`, `footer_text`, `amount_in_words` |
| DOC-004 | main | `per_type_sequence` / `type_prefix` / `year_in_number` / `per_branch_sequence` / `no_gaps` / `other` / `dont_know` |
| DOC-005 | main (multiPriority) | `print` / `pdf_email` / `pdf_whatsapp` / `view_link` / `other` / `dont_know` |
| DOC-006 | main | `invoice_to_mobile` / `paper_receipt` / `both` / `dont_know` |
| RPT-001 | main (max 8) | `sales_today_month` `cash_available` `customer_receivables` `supplier_payables` `month_profit` `below_reorder` `pending_my_approval` `expenses_vs_budget` `deals_closing` `attendance_today` `project_profitability` / `other` / `dont_know` |
| RPT-002 | main | `per_role_dashboard` / `single_dashboard_hidden` / `dont_know` |
| RPT-003 | main | `print` / `pdf` / `excel` / `scheduled_email` / `dont_know` |
| RPT-004 | main (list) | cols `report`, `recipient` (role), `frequency` (`daily` / `weekly` / `monthly`), `time` |

## Conventions used in shared-a.json beyond BANK-SCHEMA.md (for the integration step)

- `forEach` on a Template (`"forEach": "DOC-003#main"` or `"GEN-008"`): the bank's «x» templates (one requirement per row / selected option). Inside such a template, `{{Q:QID#part.col}}`, `{{SW:QID#part.col|…}}`, and Expr refs `"QID#part.col"` resolve to the **current row's** cell; `{{Q:QID}}` on a multi/multiPriority part resolves to the current option.
- `optionsFrom: "ROL-001"` on a multi part (GEN-009.ب): options are the ROL-001 rows (+ dynamic recipients).
- Column `"multiple": true` on a `role` column: multi-select of roles. Columns may carry `condition` (Expr).
- List rows may carry `key` and `condition`; `fixedRows: true` = rows cannot be added/removed (ROL-004, ROL-008).
- Section `ruleRefs` / `conflictRefs`: the bank's per-section reference tables (rule text lives in rules-general.json and unit files).
- Template `computed` (GEN-R010): formula for a computed slot; `note`: a sub-item of the template kept verbatim.
- Refs to parts of other units' questions use `#a` / `#b` / `#c` for the bank's (أ) / (ب) / (ج): `SAL-031#b`, `TRS-012#a`.
