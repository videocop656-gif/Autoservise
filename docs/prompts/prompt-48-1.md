# Prompt 48.1 — Production Hardening + Supabase Migration

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# PROMPT 48.1 — Production Hardening + Supabase Migration

## ROLE

Ты работаешь как senior full-stack / backend engineer над существующим проектом Autoservise.

Prompt 48 уже реализован и закоммичен локально:

`ff88d90 — feat: add service follow-up retention loop`

Не переписывай Prompt 48 и не расширяй продукт новыми функциями.

Твоя задача — безопасно подготовить реализованный Service Follow-up / Retention Loop к работе с основной Supabase database, устранить выявленные consistency/race-condition риски и после этого запустить приложение для ручной визуальной проверки.

---

# 1. SOURCE OF TRUTH

Перед любыми изменениями прочитай:

- `docs/prompts/prompt-48.md`
- `docs/final-reports/final-report-48.md`
- Prisma schema
- все Prisma migrations
- ServiceRecord service/repository/API
- ServiceFollowUp service/repository/API
- CustomerRequest service/repository/API
- Appointment lifecycle
- Operations follow-up implementation
- tenant isolation tests
- текущую конфигурацию Supabase / DATABASE_URL / DIRECT_URL

Также проверь:

```bash
git status
git log --oneline -n 8
```

Ожидаемый HEAD перед началом:

`ff88d90`

Если состояние отличается — сначала зафиксируй это в отчёте и не делай destructive actions.

---

# 2. STRICT SCOPE

Этот prompt разрешает только:

1. безопасно проверить доступность основной Supabase;
2. проверить состояние Prisma migrations;
3. применить уже существующую migration Prompt 48;
4. проверить schema после migration;
5. устранить atomicity issue:
   `ServiceRecord → ServiceFollowUp`;
6. устранить race condition:
   `ServiceFollowUp → CustomerRequest`;
7. усилить BOOKED invariant;
8. согласовать lifecycle ServiceRecord archive → FollowUp;
9. regression tests;
10. browser validation;
11. запуск приложения для ручной проверки;
12. documentation;
13. один локальный commit.

НЕ добавлять:

- CRM;
- email;
- рассылки;
- Telegram/WhatsApp/SMS reminders;
- CPBS;
- cron;
- background jobs;
- AI reminders;
- capacity/resources/posts;
- billing/payments;
- mileage prediction;
- новые product modules;
- launch-screen изменения;
- Conversation → Request integration;
- любые Prompt 49 features.

Это hardening существующего Prompt 48, а не новый product milestone.

---

# 3. SUPABASE — SAFETY FIRST

Главное правило:

## НЕ ПОТЕРЯТЬ СУЩЕСТВУЮЩИЕ ДАННЫЕ.

Запрещено безусловно:

```bash
prisma migrate reset
prisma db push --force-reset
DROP DATABASE
DROP SCHEMA
TRUNCATE
```

Не удаляй существующие таблицы, записи, пользователей, tenants, businesses, customers, appointments, service records и другие production/dev данные основной Supabase.

Не создавай новую Supabase project/database вместо существующей.

---

# 4. CHECK DATABASE CONNECTIVITY

Сначала проверь доступность Supabase через существующую конфигурацию проекта.

Проверь:

- `DATABASE_URL`
- `DIRECT_URL`
- Prisma connection
- `npx prisma migrate status`

Не печатай secrets/tokens/passwords в terminal output или Final Report.

Если Supabase снова отвечает `P1001`:

STOP database mutation work.

Не пытайся обходить проблему destructive-командами.

В Final Report точно укажи:

- какая проверка выполнена;
- какой error code получен;
- migration НЕ применена;
- что требуется от пользователя.

При недоступной Supabase всё ещё можно анализировать/исправлять код и тесты, но нельзя утверждать, что production migration проверена.

---

# 5. MIGRATION STATUS

Если Supabase доступна:

выполни:

```bash
npx prisma migrate status
```

Определи:

- какие migrations уже применены;
- какие pending;
- нет ли divergence;
- нет ли failed migration.

Особенно проверь:

`20260929120000_service_follow_up_retention_loop`

Если обнаружена неожиданная migration history divergence — STOP.

Не используй `migrate resolve` автоматически.

Сначала зафиксируй проблему в Final Report.

---

# 6. APPLY PROMPT 48 MIGRATION

Только если:

- database доступна;
- migration history корректна;
- Prompt 48 migration действительно pending;
- нет признаков destructive change.

Выполни:

```bash
npx prisma migrate deploy
```

После этого:

```bash
npx prisma migrate status
npx prisma validate
```

Migration должна создать/добавить только ожидаемые Prompt 48 изменения:

- `Service.repeatIntervalDays`
- `ServiceFollowUp`
- enum/status structures
- indexes
- constraints
- relations

Не должно быть удаления существующих production data.

---

# 7. POST-MIGRATION VERIFICATION

Проверь фактическую database schema.

Подтверди:

- `repeatIntervalDays` существует;
- `ServiceFollowUp` существует;
- indexes существуют;
- unique constraint для `serviceRecordId` существует;
- CHECK `repeatIntervalDays > 0` существует;
- существующие данные сохранились.

Сделай read-only sanity checks количества основных записей до/после migration, где возможно:

- tenants;
- businesses;
- customers;
- vehicles;
- appointments;
- service records.

Не нужно раскрывать пользовательские данные.

Нужно подтвердить только отсутствие неожиданной потери данных.

---

# 8. FIX ATOMICITY — SERVICE RECORD + FOLLOW-UP

Prompt 48 оставил известную проблему:

ServiceRecord сохраняется отдельно от ServiceFollowUp.

Это может привести к состоянию:

ServiceRecord сохранён → FollowUp failed → API вернул ошибку.

Исправь это.

Создание/обновление ServiceRecord и соответствующее изменение ServiceFollowUp должны выполняться как одна атомарная database transaction там, где они являются частью одной операции.

Требование:

Either both commit, or both rollback.

Используй существующий Prisma transaction mechanism.

Не создавай параллельную архитектуру.

Не дублируй business logic.

Сохрани все Prompt 48 правила:

- manual due date wins;
- otherwise service repeat interval;
- otherwise no follow-up;
- PENDING update in place;
- terminal follow-up не пересоздаётся;
- clearing date корректно закрывает PENDING;
- historical ServiceRecord without Appointment работает.

Добавь tests на rollback.

Минимум:

1. ServiceRecord create + follow-up success → both exist.
2. Follow-up failure → ServiceRecord transaction rollback.
3. ServiceRecord update + follow-up update → both commit.
4. follow-up update failure → ServiceRecord update rollback.

---

# 9. FIX RACE CONDITION — CREATE CUSTOMER REQUEST

Prompt 48 оставил race condition:

два параллельных вызова:

`POST /api/follow-ups/:id/request`

могут создать два CustomerRequest, один из которых останется несвязанным.

Исправь на database/application transaction level.

Требование:

для одного ServiceFollowUp может быть создан максимум один CustomerRequest через этот endpoint.

Повторный последовательный или конкурентный вызов должен вернуть тот же существующий request.

Не полагайся на disabled button в UI.

UI blocking — только UX, не concurrency protection.

Используй транзакцию / conditional update / locking-compatible strategy, подходящую существующему Prisma/PostgreSQL stack.

Добавь concurrency test.

Минимальная проверка:

10 конкурентных вызовов одного follow-up →

- ровно один CustomerRequest;
- один `customerRequestId`;
- follow-up CONTACTED;
- все успешные/idempotent responses указывают на один request;
- нет orphan CustomerRequest.

---

# 10. BOOKED INVARIANT

Prompt 48 допускает ручной:

`PATCH status=BOOKED`

без подтверждения Appointment.

Это противоречит смыслу BOOKED.

Исправь invariant:

## BOOKED означает, что реально существует Appointment, связанный с повторным CustomerRequest согласно текущему lifecycle.

Не разрешай произвольный manual PATCH:

`PENDING → BOOKED`
или
`CONTACTED → BOOKED`

если подтверждённого Appointment нет.

Существующий автоматический путь:

CustomerRequest → CONVERTED → Appointment exists → FollowUp BOOKED

сохрани.

Если API получает ручной PATCH BOOKED без требуемого appointment:

верни понятную 400 domain error.

Не создавай Appointment автоматически.

Добавь tests.

---

# 11. SERVICE RECORD ARCHIVE → FOLLOW-UP

Prompt 48 оставил:

архивированный ServiceRecord может иметь активный PENDING follow-up.

Определи и реализуй безопасный invariant:

Если ServiceRecord архивируется и его ServiceFollowUp всё ещё PENDING:

→ FollowUp должен стать DISMISSED.

Если FollowUp уже:

- CONTACTED
- BOOKED
- DISMISSED

не переписывай историю автоматически.

Архивирование ServiceRecord и изменение PENDING follow-up должны быть атомарны, если они выполняются одной пользовательской операцией.

Добавь tests.

---

# 12. DO NOT FIX OTHER PROMPT 47 GAPS

В этом prompt НЕ исправлять:

- IN_PROGRESS → CANCELLED при существующем ServiceRecord;
- service capacity;
- posts/resources/masters;
- billing;
- Conversation → Request UI;
- Dashboard URL state;
- frontend test architecture;
- Operations 100-item pagination limit.

Они остаются для следующих milestones.

---

# 13. TENANT ISOLATION

Все hardening changes должны сохранить:

`tenantId + businessId`

isolation.

Проверь:

- transaction logic;
- create-request concurrency logic;
- archive logic;
- BOOKED validation.

Foreign tenant:

- GET → 404
- PATCH → 404
- POST request → 404

Не раскрывать факт существования чужого объекта.

---

# 14. TESTS

Не удаляй и не ослабляй существующие tests.

До изменений зафиксируй baseline test count.

После изменений должны быть новые tests минимум для:

### Atomicity

- create rollback;
- update rollback;
- archive rollback.

### Concurrency

- parallel request creation;
- no orphan request;
- idempotent returned request.

### BOOKED

- no appointment → rejected;
- valid converted request + appointment → BOOKED;
- terminal status protections remain.

### Archive

- PENDING → DISMISSED;
- CONTACTED unchanged;
- BOOKED unchanged;
- DISMISSED unchanged.

### Tenant isolation

проверить новые paths.

---

# 15. REGRESSION

Обязательно:

```bash
npm run typecheck
npm run build
npm test
```

Все должны PASS.

Сообщи реальные числа тестов.

Не пиши PASS, если команда фактически не запускалась.

---

# 16. BROWSER VALIDATION

Если Supabase migration успешно применена:

запусти приложение на существующей Supabase.

Не используй temporary PostgreSQL для финальной browser validation этого prompt.

Проверь минимум:

### Scenario A

Service с repeat interval →

ServiceRecord →

автоматический next contact →

Operations показывает follow-up.

### Scenario B

ручная дата →

она побеждает interval.

### Scenario C

«Создать обращение» →

CustomerRequest создан →

follow-up CONTACTED →

повторный вызов не создаёт дубль.

### Scenario D

CustomerRequest получает реальный Appointment и CONVERTED →

follow-up BOOKED.

### Scenario E

архивировать ServiceRecord с PENDING →

follow-up DISMISSED.

### Scenario F

Client Detail и Vehicle Detail показывают корректный ближайший PENDING.

Проверь browser console на ошибки.

---

# 17. START APP FOR USER VISUAL REVIEW

После успешной migration и browser validation:

оставь dev server запущенным.

В финальном ответе напиши отдельной строкой:

`LOCAL APP URL: http://localhost:...`

Используй фактический порт.

Не останавливай dev server после Final Report, если среда позволяет оставить его работающим.

Пользователь должен открыть приложение вручную и сделать screenshots.

---

# 18. SCREENSHOT TARGETS

Не делай redesign.

Не меняй UI только ради screenshots.

После запуска приложение должно позволить пользователю открыть:

1. Operations → «Повторный контакт»
2. Service Record → «Следующий контакт»
3. Services → «Интервал повторного обслуживания»
4. Client Detail → «Следующий контакт»
5. при необходимости Vehicle Detail → «Следующий контакт»

---

# 19. DOCUMENTATION

Создай:

`docs/prompts/prompt-48-1.md`

и

`docs/final-reports/final-report-48-1.md`

Final Report должен содержать:

1. Initial state
2. Supabase connectivity
3. Migration status before
4. Migration deployment
5. Post-migration verification
6. Data safety verification
7. Atomicity fix
8. Concurrency fix
9. BOOKED invariant
10. Archive behavior
11. Tenant isolation
12. Tests
13. Typecheck
14. Build
15. Browser validation
16. Known limitations remaining
17. Git status
18. Local URL

---

# 20. GIT

После успешного hardening:

```bash
git status
git diff
git log --oneline -n 8
```

Создай ОДИН новый локальный commit:

`fix: harden service follow-up retention loop`

## DO NOT PUSH.

Не выполняй:

```bash
git push
```

Не меняй:

- GitHub default branch;
- origin;
- remote branches;
- GitHub settings.

Ожидаемый результат:

`master` будет на 2 commits впереди `origin/master`:

1. `ff88d90`
2. новый Prompt 48.1 commit

---

# 21. FAILURE RULE

Если Supabase остаётся недоступной:

не симулируй успешный production migration.

Не подменяй её temporary database и не называй это production verification.

Можно завершить code hardening и tests локально, но Final Report должен явно сказать:

`BLOCKED: Supabase migration and production browser validation not completed.`

В таком случае:

- commit hardening допустим только если tests проходят;
- push запрещён;
- deployment запрещён;
- Prompt 49 пока не начинать.

---

# 22. ACCEPTANCE CRITERIA

Prompt 48.1 считается полностью завершённым только если:

AC1. Supabase доступна.

AC2. Migration history проверена.

AC3. Prompt 48 migration применена через safe migration path.

AC4. Existing data не потеряны.

AC5. `ServiceRecord + ServiceFollowUp` atomic.

AC6. Concurrent request creation не создаёт дублей/orphans.

AC7. BOOKED невозможен без реального Appointment.

AC8. Archive PENDING follow-up → DISMISSED.

AC9. Tenant isolation сохранена.

AC10. Existing Prompt 48 behavior сохранён.

AC11. TypeScript PASS.

AC12. Build PASS.

AC13. Все tests PASS.

AC14. Browser validation на основной Supabase PASS.

AC15. Создан один локальный hardening commit.

AC16. Ничего не pushed.

AC17. Dev server оставлен доступным для визуальной проверки и фактический LOCAL APP URL передан пользователю.

Если AC1–AC4 или AC14 невозможно выполнить из-за недоступности Supabase, результат должен быть обозначен как BLOCKED/PARTIAL, а не как полный PASS.

---

# 23. EXECUTION ORDER

Работай строго в таком порядке:

1. Read source of truth
2. Git state
3. Supabase connectivity
4. Prisma migration status
5. Safe migration deploy, если разрешено
6. Post-migration verification
7. Atomicity hardening
8. Concurrency hardening
9. BOOKED invariant
10. Archive invariant
11. Tests
12. Typecheck
13. Build
14. Browser validation on Supabase
15. Start/leave dev server running
16. Documentation
17. Local commit
18. Final Report
19. STOP

После этого НЕ начинай Prompt 49.

НЕ PUSH.
