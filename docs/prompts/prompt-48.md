# Prompt 48 — Service Follow-up / Retention Loop

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).
> This is the complete Prompt 48 that was actually implemented; an earlier
> copy of it arrived truncated mid-section-4 and was not acted on.

---

# Prompt 48 — Service Follow-up / Retention Loop

## Роль

Ты работаешь как senior product engineer / product architect над проектом:

**AI-администратор для автосервисов** (`autoservise`).

Prompt 47 завершил Post-MVP Product Gap Audit и подтвердил P1 gap:

> Основной lifecycle работает до Service History, но следующий контакт после обслуживания не представлен как структурированные данные и не попадает в operational queue.

Задача Prompt 48 — **реализовать только один milestone: Service Follow-up / Retention Loop.**

После реализации lifecycle должен стать:

```text
Customer
→ Customer Request
→ Appointment
→ Service
→ Service Record
→ Service History
→ Service Follow-up
→ Customer Request
```

---

# 1. SOURCE OF TRUTH

Перед изменениями прочитай:

* `docs/prompts/`
* `docs/final-reports/`
* актуальную Prisma schema
* актуальные migrations
* CustomerRequest services/API
* Appointment services/API
* ServiceRecord services/API
* Operations UI/API
* Client Detail
* Vehicle Detail
* Services settings
* существующие tests

Особенно изучи:

* Prompt 41
* Prompt 42
* Prompt 43
* Prompt 44
* Prompt 45
* Prompt 46
* Prompt 47
* `docs/final-reports/final-report-47.md`, если файл существует

**Текущий код имеет приоритет над старой документацией.**

Не переизобретай уже существующую архитектуру.

---

# 2. STRICT SCOPE

В рамках Prompt 48 реализовать только:

1. `Service.repeatIntervalDays`
2. `ServiceFollowUp`
3. создание follow-up из ServiceRecord
4. state machine follow-up
5. API follow-ups
6. создание CustomerRequest из follow-up
7. Operations follow-up queue
8. Client Detail follow-up visibility
9. Vehicle Detail follow-up visibility
10. tenant isolation
11. idempotency
12. tests
13. browser validation
14. documentation

НЕ реализовывать:

* service capacity;
* posts/resources;
* billing;
* payments;
* automated messaging;
* cron;
* background jobs;
* AI reminders;
* mileage prediction;
* conversation/request linking;
* launch screen changes;
* frontend test framework.

Если обнаружишь такие gaps — **не исправляй их**, а укажи в Final Report.

---

# 3. SERVICE REPEAT INTERVAL

Добавь в модель `Service`:

```text
repeatIntervalDays Int?
```

Правила:

* `null` = интервал не задан;
* значение должно быть положительным целым числом;
* `0` недопустим;
* существующие услуги не должны ломаться;
* migration должна быть backward-compatible.

## UI

В настройках услуги добавить:

**Интервал повторного обслуживания**

Например:

```text
[ 180 ] дней
```

Пустое значение:

```text
Не задан
```

Использовать существующий UI/design system.

Не использовать текстовое поле вроде `"через полгода"` как источник бизнес-логики.

---

# 4. SERVICE FOLLOW-UP MODEL

Создай Prisma model:

```text
ServiceFollowUp
```

Минимальные поля:

```text
id
tenantId
businessId

customerId
vehicleId

serviceId?
serviceRecordId?

dueAt

status

customerRequestId?

note?

createdAt
updatedAt
```

Связи:

* Tenant
* Business
* Customer
* Vehicle
* Service
* ServiceRecord
* CustomerRequest

Используй существующий стиль relations проекта.

Добавь необходимые индексы.

Обязательный operational index:

```text
[tenantId, businessId, status, dueAt]
```

Также добавь индексы для customer/vehicle/serviceRecord/customerRequest, если они нужны существующим запросам.

---

# 5. FOLLOW-UP STATUS

Использовать строго:

```text
PENDING
CONTACTED
BOOKED
DISMISSED
```

### PENDING

Ожидает действия сотрудника.

### CONTACTED

Follow-up обработан сотрудником, и дальнейшая работа передана в CustomerRequest.

Важно:

**CONTACTED не означает, что клиент согласился на запись.**

### BOOKED

Связанное повторное обслуживание действительно назначено.

### DISMISSED

Повторный контакт больше не требуется.

---

# 6. STATUS TRANSITIONS

Создай явную transition matrix.

Разрешено:

```text
PENDING → CONTACTED
PENDING → BOOKED
PENDING → DISMISSED

CONTACTED → BOOKED
CONTACTED → DISMISSED
```

Запрещено:

```text
BOOKED → *
DISMISSED → *
```

Недопустимый переход должен возвращать HTTP 400 с существующим стилем ошибок проекта.

Не разрешать произвольный PATCH status без domain validation.

---

# 7. FOLLOW-UP CREATION RULE

Follow-up создаётся только после успешного создания ServiceRecord.

Есть три случая.

## Case A — manual date

Если пользователь указал дату следующего контакта:

```text
dueAt
```

использовать именно её.

Она имеет приоритет над интервалом услуги.

---

## Case B — service interval

Если manual date отсутствует и:

```text
Service.repeatIntervalDays > 0
```

то:

```text
dueAt =
ServiceRecord.performedAt
+
Service.repeatIntervalDays
```

Использовать timezone/business date logic проекта.

---

## Case C — no follow-up

Если:

* manual date отсутствует;
* `repeatIntervalDays` отсутствует;

follow-up не создавать.

---

# 8. SERVICE RECORD UI

В форме ServiceRecord добавить:

**Следующий контакт**

Дата.

Поведение:

* если услуга имеет `repeatIntervalDays`, дата рассчитывается автоматически;
* пользователь может изменить дату;
* manual date имеет приоритет;
* очистка даты означает отсутствие follow-up;
* существующие ServiceRecord без follow-up продолжают работать.

Не создавать follow-up при простом открытии формы.

Создание происходит только после успешного сохранения ServiceRecord.

---

# 9. HISTORICAL SERVICE RECORDS

В проекте существуют ServiceRecord без Appointment.

Prompt 48 не должен требовать Appointment.

Follow-up должен работать для:

```text
ServiceRecord
+
Customer
+
Vehicle
```

даже если Appointment отсутствует.

---

# 10. IDEMPOTENCY

Для одного ServiceRecord:

```text
max one active PENDING follow-up
```

Если ServiceRecord сохраняется повторно:

* не создавать duplicate PENDING;
* если PENDING существует и дата изменена — обновить существующий PENDING;
* если follow-up уже BOOKED или DISMISSED — не создавать автоматически новый follow-up.

Не создавать скрытые дополнительные follow-ups.

---

# 11. API

Добавить:

## GET

```text
GET /api/follow-ups
```

Query parameters:

```text
status
dueBefore
customerId
vehicleId
```

Все optional.

---

## PATCH

```text
PATCH /api/follow-ups/:id
```

Разрешить:

* status
* dueAt
* note

Status проходит через transition matrix.

---

## POST

```text
POST /api/follow-ups/:id/request
```

Создаёт CustomerRequest.

Передать:

```text
customerId
vehicleId
serviceId
source = MANUAL
```

Если `serviceId` отсутствует у follow-up — не передавать его.

После успешного создания:

```text
followUp.status = CONTACTED
followUp.customerRequestId = request.id
```

---

# 12. CREATE REQUEST IDEMPOTENCY

Повторный вызов:

```text
POST /api/follow-ups/:id/request
```

не должен создавать новый CustomerRequest.

Если:

```text
customerRequestId != null
```

вернуть уже существующий request.

Если follow-up находится в:

```text
BOOKED
DISMISSED
```

новый request не создавать.

---

# 13. BOOKED SEMANTICS

Создание CustomerRequest означает:

```text
PENDING → CONTACTED
```

а не BOOKED.

`BOOKED` означает, что реально существует последующее Appointment.

Если архитектура текущего Appointment/CustomerRequest lifecycle позволяет безопасно связать Appointment с follow-up:

```text
CONTACTED → BOOKED
```

при фактическом создании записи.

Если для этого требуется существенно менять существующий lifecycle — **не расширяй scope самостоятельно**.

В таком случае:

* оставь `CONTACTED`;
* документируй ограничение в Final Report.

---

# 14. OPERATIONS QUEUE

В `/operations` добавить отдельную секцию:

## Повторный контакт

Показывать только:

```text
PENDING
```

с:

```text
dueAt <= today + 7 days
```

по timezone бизнеса.

Сортировка:

1. просроченные;
2. сегодня;
3. будущие.

Внутри:

```text
dueAt ASC
```

---

# 15. OPERATIONS ROW

Показывать:

* клиент;
* автомобиль;
* услуга;
* дата;
* статус;
* note, если есть.

Actions:

### Создать обращение

Создаёт CustomerRequest.

После успеха:

* follow-up становится CONTACTED;
* появляется customer request;
* follow-up исчезает из PENDING queue.

### Отложить

Изменяет `dueAt`.

Статус остаётся:

```text
PENDING
```

Не добавлять новый SNOOZED status.

### Не требуется

```text
PENDING → DISMISSED
```

После этого follow-up исчезает из активной очереди.

---

# 16. CLIENT DETAIL

Добавить блок:

## Следующий контакт

Показывать ближайший:

```text
PENDING
```

follow-up клиента.

Показывать:

* дату;
* автомобиль;
* услугу;
* note.

Если нет активного follow-up:

```text
Следующий контакт не запланирован
```

Terminal follow-ups не считать активным следующим контактом.

---

# 17. VEHICLE DETAIL

Добавить аналогичный блок:

## Следующий контакт

Показывать ближайший PENDING follow-up конкретного автомобиля.

---

# 18. TIMEZONE

Использовать существующую business timezone logic.

Не использовать timezone браузера как source of truth.

Обязательно проверить:

* overdue;
* today;
* today + 7 days;
* границы суток;
* DST, если применимо.

---

# 19. TENANT ISOLATION

Каждая операция должна быть scoped:

```text
tenantId
+
businessId
```

Проверить:

* GET;
* PATCH;
* POST request;
* Operations;
* Client Detail;
* Vehicle Detail.

Чужой follow-up:

```text
404
```

Не раскрывать существование объекта другого tenant.

Добавить тесты в существующий tenant isolation suite.

---

# 20. DATA VALIDATION

Проверить:

### repeatIntervalDays

* null допустим;
* positive integer допустим;
* zero запрещён;
* negative запрещён;
* дробное значение запрещено.

### dueAt

* валидная дата;
* корректное сохранение timezone semantics.

### status

* только четыре допустимых значения.

---

# 21. TESTS

Добавить tests минимум для:

1. repeat interval creates follow-up;
2. manual date overrides interval;
3. no date + no interval = no follow-up;
4. duplicate PENDING prevention;
5. PENDING date update;
6. terminal state protection;
7. valid transitions;
8. invalid transitions;
9. CustomerRequest creation;
10. CustomerRequest idempotency;
11. customer copied correctly;
12. vehicle copied correctly;
13. service copied correctly;
14. source = MANUAL;
15. tenant isolation;
16. Operations due window;
17. timezone boundaries;
18. historical ServiceRecord without Appointment.

Не удалять и не ослаблять существующие tests.

---

# 22. BROWSER VALIDATION

После backend tests выполнить реальный UI walkthrough.

## Scenario A — automatic interval

1. Services.
2. Выбрать услугу.
3. Установить `180 дней`.
4. Создать appointment.
5. Перевести в COMPLETED.
6. Создать ServiceRecord.
7. Проверить рассчитанную дату.
8. Сохранить.
9. Открыть Operations.
10. Проверить follow-up.

## Scenario B — manual date

1. Создать ServiceRecord.
2. Указать другую дату.
3. Сохранить.
4. Проверить, что manual date победила interval.

## Scenario C — create request

1. Открыть follow-up.
2. Нажать «Создать обращение».
3. Проверить CustomerRequest.
4. Проверить customer.
5. Проверить vehicle.
6. Проверить service.
7. Проверить source = MANUAL.
8. Повторить действие.
9. Убедиться, что дубль не создан.

## Scenario D — dismiss

1. Нажать «Не требуется».
2. Проверить DISMISSED.
3. Проверить отсутствие в активной очереди.

## Scenario E — postpone

1. Изменить dueAt.
2. Сохранить.
3. Проверить новую дату.
4. Проверить PENDING.

---

# 23. REGRESSION

После реализации выполнить фактически:

```text
npm run typecheck
npm run build
npm test
```

Все существующие tests должны остаться зелёными.

В отчёте указать реальные числа.

Не писать PASS без фактического выполнения.

---

# 24. EXISTING PROTECTIONS

Не ломать:

* CANCELLED / NO_SHOW ServiceRecord protection;
* appointment transitions;
* CustomerRequest lifecycle;
* tenant isolation;
* customer/vehicle/service consistency;
* archive behavior;
* existing Operations queue;
* existing date filtering;
* Lead retirement.

---

# 25. UI / DESIGN

Использовать существующий дизайн.

Использовать:

* shadcn/ui;
* существующие buttons;
* badges;
* cards;
* forms;
* dialogs;
* date inputs;
* toast/error patterns;
* PageHeader;
* PageContainer.

Не менять глобальные design tokens.

Не менять AppLaunchScreen.

---

# 26. MIGRATION

Создать Prisma migration.

Не удалять существующие данные.

Migration должна быть backward-compatible.

После migration:

```text
npx prisma validate
```

и существующий migration workflow проекта.

---

# 27. DOCUMENTATION

Создать:

```text
docs/prompts/prompt-48.md
docs/final-reports/final-report-48.md
```

`prompt-48.md` должен содержать фактически использованный Prompt 48.

Final Report должен содержать:

```text
## Final Report — Prompt 48: Service Follow-up / Retention Loop

### 1. Implementation Result
### 2. Data Model
### 3. Migration
### 4. Domain Logic
### 5. API
### 6. UI
### 7. Operations
### 8. Client / Vehicle Visibility
### 9. Idempotency
### 10. Tenant Isolation
### 11. Tests
### 12. Browser Validation
### 13. Regression Validation
### 14. Git
### 15. Known Limitations
```

---

# 28. GIT RULES

После реализации проверить:

```bash
git status
git log --oneline -n 5
```

Создать **один локальный commit**:

```text
feat: add service follow-up retention loop
```

### ВАЖНО

**НЕ ДЕЛАТЬ PUSH.**

После commit остановиться.

Не выполнять:

```text
git push
git push --force
git push --force-with-lease
```

Почему:

* GitHub сейчас синхронизирован;
* `master` является default branch;
* Prompt 48 должен сначала пройти проверку здесь;
* push решим отдельно после просмотра Final Report.

---

# 29. FINAL REPORT

В конце ответа обязательно выдай полный:

```text
Final Report — Prompt 48: Service Follow-up / Retention Loop
```

Обязательно укажи:

* изменённые файлы;
* migration;
* API;
* UI;
* domain rules;
* idempotency;
* tenant isolation;
* количество tests до;
* количество tests после;
* typecheck;
* build;
* tests;
* browser validation;
* git commit;
* push status.

Если какая-либо часть scope не реализована:

1. явно указать;
2. объяснить причину;
3. не скрывать это;
4. не компенсировать самовольным расширением scope.

---

# 30. FINAL ACCEPTANCE CRITERIA

Prompt 48 считается успешно реализованным, если:

### AC1

У услуги можно задать:

```text
repeatIntervalDays = 180
```

### AC2

ServiceRecord с этой услугой создаёт:

```text
PENDING ServiceFollowUp
```

с:

```text
dueAt = performedAt + 180 days
```

### AC3

Manual date переопределяет interval.

### AC4

ServiceRecord без interval и без manual date не создаёт follow-up.

### AC5

Один ServiceRecord не создаёт duplicate PENDING follow-ups.

### AC6

Follow-up отображается в Operations в окне:

```text
today ... today + 7 days
```

по timezone бизнеса.

### AC7

«Создать обращение» создаёт один CustomerRequest с:

* правильным customer;
* правильным vehicle;
* правильным service;
* `source = MANUAL`.

### AC8

Повторное нажатие не создаёт второй CustomerRequest.

### AC9

Follow-up связывается с созданным CustomerRequest.

### AC10

Follow-up другого tenant недоступен.

### AC11

«Не требуется» переводит:

```text
PENDING → DISMISSED
```

### AC12

Недопустимые status transitions блокируются.

### AC13

Ближайший PENDING follow-up виден в Client Detail и Vehicle Detail.

### AC14

Существующий lifecycle продолжает проходить без регрессий.

### AC15

Typecheck, build и все tests проходят.

### AC16

Создан один локальный commit:

```text
feat: add service follow-up retention loop
```

### AC17

**Push НЕ выполняется.**

---

# FINAL INSTRUCTION

Работай строго последовательно:

```text
Schema
→ Migration
→ Domain / Service
→ API
→ ServiceRecord UI
→ Operations
→ Client Detail
→ Vehicle Detail
→ Tests
→ Browser validation
→ Regression
→ Documentation
→ Local commit
→ STOP
```

После локального commit **остановись и выдай Final Report**.

Не push.

Не менять GitHub.

Не делать следующий milestone.

Не трогать launch screen.

Главная цель:

> **замкнуть retention loop от завершённого обслуживания обратно к новому CustomerRequest.**
