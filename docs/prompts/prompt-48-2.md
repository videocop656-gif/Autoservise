# Prompt 48.2 — UI Polish / Russian Localization for Retention Screens

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).
> This is the complete Prompt 48.2 that was implemented; an earlier copy
> arrived truncated after section 1 and only a read-only audit was done
> for it.

---

# PROMPT 48.2 — UI Polish / Russian Localization for Retention Screens

## CONTEXT

Prompt 48 and Prompt 48.1 are complete.

Current commits:
- ff88d90 — Service Follow-up / Retention Loop
- b741d90 — Production Hardening

Supabase migration is applied.
Existing data is preserved.
Tests: 1344/1344 PASS.
Browser validation on Supabase: 62/62 PASS.

You already performed the read-only preparation for Prompt 48.2.
Do not repeat unnecessary discovery if the current information is sufficient.

This prompt is UI/UX polish only.

DO NOT start Prompt 49.
DO NOT push.

---

## 1. GOAL

Bring the existing operational UI to one consistent Russian-language product experience, especially the screens touched by Service Follow-up / Retention.

Use the existing Autoservise design system:
- dark graphite UI;
- existing gold accent;
- existing typography;
- existing shadcn/ui components;
- existing spacing/radius/tokens.

Do NOT redesign the application.
Do NOT change global visual identity.

---

## 2. SCREENS IN SCOPE

Audit and polish only the existing user-facing UI on:

1. Services / Услуги
2. Service History / История обслуживания
3. Service Record create/edit form
4. Operations / Рабочая очередь
5. Operations → Повторный контакт
6. Client Detail
7. Vehicle Detail

Do not expand into unrelated screens merely because another English string exists elsewhere.

---

## 3. RUSSIAN LOCALIZATION

Translate visible user-facing English UI strings on the screens above into natural Russian.

At minimum fix the strings already observed:

Add service
→ Добавить услугу

Deactivate
→ Деактивировать

Add
→ Добавить запись

Archive
→ Архивировать

Customer
→ Клиент

Vehicle
→ Автомобиль

Service
→ Услуга

Appointment (optional)
→ Запись (необязательно)

Date performed
→ Дата обслуживания

Time
→ Время

Mileage (km)
→ Пробег (км)

Total price
→ Итоговая стоимость

Work description
→ Выполненные работы

Parts / materials used
→ Запчасти и материалы

Recommendations
→ Рекомендации

Notes
→ Примечания

Name
→ Название

Description
→ Описание

Price from
→ Цена от

Price to
→ Цена до

Duration (min)
→ Длительность (мин)

Save
→ Сохранить

Cancel
→ Отмена

Also inspect the scoped screens for other visible English labels, placeholders, helper text and buttons.

Do not translate:
- TypeScript identifiers;
- API field names;
- API routes;
- Prisma model/field names;
- enum values;
- internal error codes;
- developer logs.

---

## 4. USER-FACING VALIDATION MESSAGES

Prompt 48 / 48.1 validation messages that are actually displayed under form fields or otherwise shown directly to users must be natural Russian.

Example:

Repeat interval must be at least 1 day
→ Интервал должен быть не менее 1 дня

Translate other Prompt 48 / 48.1 validation messages only when they are user-facing.

Keep API/internal error codes stable.

Do not alter validation semantics.

Tests that intentionally assert visible error text may be updated to the new Russian copy.

Do not weaken tests.

---

## 5. CURRENCY FORMATTING

Current UI contains values such as:

3000.00–5000.00 RUB
4800.00 RUB

For the Russian UI display these in a human-readable format.

Examples:

3000.00–5000.00 RUB
→ 3 000–5 000 ₽

4800.00 RUB
→ 4 800 ₽

Use Russian number grouping.

Do not change:
- stored numeric values;
- Prisma types;
- API representation;
- database data.

Prefer an existing shared formatter if one exists.
If none exists, add one small shared UI formatter rather than duplicating formatting logic.

Input fields may remain numeric controls where required; do not break editing by injecting formatted currency strings into numeric values.

---

## 6. SERVICE REPEAT INTERVAL

Current service list contains wording similar to:

Повтор: через 180 дн.

Change the user-facing display to:

Повторное обслуживание через 180 дней

Use correct Russian pluralization where practical:

1 день
2 дня
5 дней
21 день
22 дня
25 дней

Do not change `repeatIntervalDays` semantics or stored values.

The edit/create field should remain understandable:

Интервал повторного обслуживания

with days as the unit.

Blank value continues to mean:

Не задан

---

## 7. SERVICE RECORD — NEXT CONTACT

Verify that the existing Service Record create/edit form clearly exposes the Prompt 48 field.

Canonical label:

Следующий контакт

If helper text is needed, use concise Russian copy such as:

Дата следующего контакта с клиентом. Можно изменить вручную.

The administrator must be able to understand that:
- the date may be suggested from the service repeat interval;
- it can be manually changed;
- clearing it means no active follow-up according to existing Prompt 48 behavior.

Do NOT alter calculation or lifecycle logic.

Do NOT create a second follow-up implementation.

---

## 8. OPERATIONS — FOLLOW-UP

Keep the existing section:

Повторный контакт

Keep actions:

Создать обращение
Отложить
Не требуется

Do not change action behavior.

Ensure the administrator can visually distinguish:

Просрочено
Сегодня
Скоро

Use existing status/badge patterns.

Do not introduce aggressive new colors or redesign the card.

Do not change global design tokens.

The primary action may remain the existing gold treatment.

---

## 9. CLIENT DETAIL

Verify the existing block:

Следующий контакт

For nearest PENDING follow-up show the existing relevant data:
- date;
- vehicle;
- service;
- note if present.

If there is no active PENDING follow-up:

Следующий контакт не запланирован

No new business logic.

---

## 10. VEHICLE DETAIL

Apply the same terminology and localization.

Use:

Следующий контакт

Display the existing nearest PENDING follow-up.

Do not change selection/filtering logic.

---

## 11. SERVICE HISTORY

Use the canonical heading:

История обслуживания

All visible actions on this scoped screen must be Russian.

For example:

Archive
→ Архивировать

Add
→ Добавить запись

Do not change archive behavior.

Do not modify ServiceRecord data.

---

## 12. TERMINOLOGY CONSISTENCY

Use these canonical product terms across the scoped screens:

Клиент
Автомобиль
Услуга
Запись
История обслуживания
Следующий контакт
Повторный контакт
Рабочая очередь
Обращение
Выполненные работы
Запчасти и материалы
Рекомендации
Пробег
Итоговая стоимость
Интервал повторного обслуживания

Do not rename domain models in code merely to achieve UI localization.

---

## 13. STRICTLY DO NOT TOUCH

Do NOT modify:

- Prisma schema;
- migrations;
- ServiceFollowUp state machine;
- ServiceRecord transaction behavior;
- CustomerRequest concurrency protection;
- BOOKED invariant;
- tenant isolation;
- authentication;
- DATABASE_URL;
- DIRECT_URL;
- Supabase configuration;
- connection-pool configuration;
- launch screen;
- Dashboard behavior;
- CRM;
- CPBS;
- email;
- newsletters;
- messaging/reminder automation;
- billing;
- service capacity;
- Prompt 49 functionality.

No new npm dependencies.

The known port 6543 performance issue is OUT OF SCOPE for Prompt 48.2.

---

## 14. TESTS

Before modifications record the current baseline.

Expected baseline:

1344 tests.

After modifications run:

npm run typecheck
npm run build
npm test

All existing tests must pass.

Tests may be updated only where they intentionally verify changed user-facing text.

Do not remove or weaken behavioral tests.

Report the actual final test count.

---

## 15. BROWSER VALIDATION

Use the existing Supabase-connected environment.

Prefer the existing Prompt 48.1 validation tenant/data.

Do not create additional test tenants unless technically necessary.

Inspect at minimum:

1. Рабочая очередь → Повторный контакт
2. Настройки → Услуги
3. История обслуживания
4. Service Record create/edit
5. Client Detail
6. Vehicle Detail

Verify:

- no unintended English user-facing labels remain on these scoped screens;
- Prompt 48 validation errors visible to users are Russian;
- currency formatting is human-readable;
- service repeat interval wording is correct;
- Следующий контакт is visible and understandable;
- Повторный контакт actions remain functional;
- buttons/labels do not overflow;
- desktop layout has no obvious regression;
- mobile layout has no obvious regression;
- browser console has no new errors.

Do not mutate real user data unnecessarily.

---

## 16. SCREENSHOT / VISUAL REPORT

For the Final Report explicitly describe the visual result for:

- Рабочая очередь → Повторный контакт;
- Услуги;
- История обслуживания;
- Service Record edit form;
- Client Detail;
- Vehicle Detail.

If automated screenshots are available in the existing browser-validation setup, capture them for internal verification.

Do not add screenshot tooling or dependencies solely for this prompt.

---

## 17. DOCUMENTATION

Create/update:

docs/prompts/prompt-48-2.md

docs/final-reports/final-report-48-2.md

Final Report must include:

1. Initial state
2. Screens audited
3. Localization changes
4. User-facing validation localization
5. Currency formatting
6. Service repeat interval presentation
7. Follow-up / Next Contact UI verification
8. Client Detail verification
9. Vehicle Detail verification
10. Files changed
11. Typecheck
12. Build
13. Tests and actual count
14. Browser validation
15. Remaining UI issues
16. Git state
17. Push status
18. LOCAL APP URL

---

## 18. GIT

Before commit run:

git status
git diff
git log --oneline -n 8

Create exactly ONE local commit:

fix: polish retention UI and Russian localization

DO NOT PUSH.

Do not modify:
- origin;
- remote branches;
- GitHub default branch;
- GitHub settings.

Expected history after completion:

b741d90
+ one new Prompt 48.2 commit

Therefore master should be 3 commits ahead of origin/master.

---

## 19. ACCEPTANCE CRITERIA

Prompt 48.2 is complete only if:

AC1. Scoped retention screens are consistently Russian.

AC2. User-facing Prompt 48 validation errors are Russian.

AC3. Monetary display uses readable ₽ formatting.

AC4. Repeat interval uses natural Russian wording/pluralization.

AC5. Service Record clearly shows Следующий контакт.

AC6. Operations clearly shows Повторный контакт and existing actions still work.

AC7. Client Detail correctly shows Следующий контакт.

AC8. Vehicle Detail correctly shows Следующий контакт.

AC9. No domain/API/database behavior changed.

AC10. No Prisma migration created.

AC11. DATABASE_URL / DIRECT_URL unchanged.

AC12. Typecheck PASS.

AC13. Build PASS.

AC14. All tests PASS.

AC15. Browser validation on Supabase PASS.

AC16. Exactly one local Prompt 48.2 commit created.

AC17. Nothing pushed.

---

## 20. EXECUTION ORDER

1. Use existing read-only audit already performed
2. Record baseline
3. Localize scoped UI
4. Localize user-facing validation messages
5. Apply currency formatting
6. Polish repeat interval wording
7. Verify Next Contact UI
8. Verify Operations follow-up UI
9. Verify Client/Vehicle detail
10. Typecheck
11. Build
12. Tests
13. Browser validation on Supabase
14. Documentation
15. Git review
16. One local commit
17. Leave dev server running if possible
18. Final Report
19. STOP

At the end provide:

LOCAL APP URL: http://localhost:...

Do NOT start Prompt 49.
Do NOT push.
