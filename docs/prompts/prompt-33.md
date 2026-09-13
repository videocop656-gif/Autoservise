# Prompt 33 — Service Completion Visibility

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

=== PROMPT 33 — SERVICE COMPLETION VISIBILITY ===

ROLE

Ты — senior full-stack engineer, работающий внутри существующего проекта Autoservise.

Текущий подтверждённый доменный flow:

Conversation
→ Customer Request
→ Appointment
→ ServiceRecord
→ Vehicle Service History

Prompt 32 провёл read-only audit существующей системы.

КРИТИЧЕСКИЙ РЕЗУЛЬТАТ АУДИТА:

ServiceRecord УЖЕ существует в Prisma и является существующей сущностью для фиксации фактически выполненного обслуживания.

ServiceRecord уже содержит:

- performedAt
- mileage
- workDescription
- partsDescription
- recommendations
- totalPrice
- currency
- optional appointmentId
- tenant ownership
- Customer relation
- Vehicle relation
- Service relation
- Appointment relation

Также существует:

- ServiceRecord service/repository layer
- tenant-scoped validation
- appointment consistency validation
- mileage validation
- 60 существующих ServiceRecord tests
- Vehicle Detail → "История обслуживания"
- Client Detail → "История обслуживания"

Appointment.status уже поддерживает:

SCHEDULED
CONFIRMED
IN_PROGRESS
COMPLETED
CANCELLED
NO_SHOW

==================================================
ГЛАВНАЯ ЦЕЛЬ PROMPT 33
==================================================

Закрыть следующий UX gap:

COMPLETED Appointment может существовать без ServiceRecord.

Сейчас оператор не получает явного визуального сигнала:

"Визит завершён, но результат обслуживания ещё не зафиксирован."

Нужно сделать этот статус видимым и дать оператору понятный следующий шаг.

==================================================
КРИТИЧЕСКИЕ ОГРАНИЧЕНИЯ
==================================================

НЕ создавать:

- WorkOrder
- Invoice
- Payment
- Inventory
- Technician
- новые Prisma models
- новые database tables
- новую ServiceRecord model
- новый ServiceRecord repository, если существующий уже подходит

НЕ менять:

- Prisma schema без абсолютной необходимости
- существующий Appointment lifecycle
- существующие Appointment statuses
- Customer Request lifecycle
- Conversation lifecycle
- tenant архитектуру
- App Shell
- global design system
- global color palette

НЕ создавать автоматический пустой ServiceRecord при переходе Appointment в COMPLETED.

Это принципиально важно.

Appointment COMPLETED НЕ означает автоматически, что мы знаем содержание выполненных работ.

Поэтому:

COMPLETED + no ServiceRecord

должно означать:

"Результат обслуживания не зафиксирован."

==================================================
1. СНАЧАЛА ИЗУЧИ ТЕКУЩИЙ КОД
==================================================

Перед изменениями найди и изучи:

- Appointment model
- Appointment service
- Appointment API
- Appointment list
- Appointment detail/context UI
- ServiceRecord model
- ServiceRecord service/repository
- ServiceRecord API
- Vehicle Detail
- Client Detail
- существующие ServiceRecord forms/components, если они уже существуют
- существующие status badges
- существующие toast/error/loading patterns
- существующие navigation patterns

Особенно проверь:

как сейчас Appointment Detail получает информацию о связанных ServiceRecords.

Если подходящая relation/query уже существует — используй её.

НЕ создавать второй способ получения ServiceRecord.

==================================================
2. ОСНОВНОЙ UX
==================================================

В существующем Appointment UI:

если:

Appointment.status === COMPLETED

и

для этого Appointment НЕТ ServiceRecord

показать заметный, но НЕ агрессивный warning/state.

Текст должен быть понятен оператору.

Предпочтительный смысл:

"Результат обслуживания не зафиксирован"

И действие:

"Добавить результат обслуживания"

Используй существующий язык интерфейса проекта.

Если в проекте уже есть подходящая формулировка — используй её вместо создания новой.

==================================================
3. ЕСЛИ SERVICE RECORD УЖЕ СУЩЕСТВУЕТ
==================================================

Если:

Appointment.status === COMPLETED

и ServiceRecord существует:

НЕ показывать warning.

Вместо него показать нормальное состояние:

"Результат обслуживания зафиксирован"

или существующий эквивалент.

Должна оставаться возможность открыть существующий ServiceRecord/историю, если такой navigation pattern уже существует.

НЕ создавать duplicate ServiceRecord.

==================================================
4. ЕСЛИ APPOINTMENT НЕ COMPLETED
==================================================

Для:

SCHEDULED
CONFIRMED
IN_PROGRESS
CANCELLED
NO_SHOW

не показывать warning:

"Результат обслуживания не зафиксирован"

если это не соответствует существующей бизнес-логике.

Главное правило:

WARNING относится именно к:

COMPLETED + missing ServiceRecord

==================================================
5. ACTION "ДОБАВИТЬ РЕЗУЛЬТАТ ОБСЛУЖИВАНИЯ"
==================================================

При нажатии:

"Добавить результат обслуживания"

используй существующий ServiceRecord creation flow, если он уже существует.

Сначала проверь, существует ли:

- ServiceRecord create endpoint
- ServiceRecord form
- ServiceRecord dialog
- ServiceRecord creation service
- reusable form

Если существует:

ПЕРЕИСПОЛЬЗУЙ его.

НЕ создавать второй form.

НЕ создавать второй endpoint.

НЕ создавать duplicate validation.

==================================================
6. ЕСЛИ SERVICE RECORD CREATE UI УЖЕ СУЩЕСТВУЕТ
==================================================

Интегрируй существующий UI в Appointment context.

Идеальный flow:

Appointment COMPLETED
→ no ServiceRecord
→ "Результат обслуживания не зафиксирован"
→ "Добавить результат обслуживания"
→ существующая ServiceRecord form
→ Save
→ Appointment context обновляется
→ warning исчезает
→ "Результат обслуживания зафиксирован"

==================================================
7. ЕСЛИ SERVICE RECORD CREATE UI НЕ СУЩЕСТВУЕТ
==================================================

НЕ создавай полноценную новую сложную систему.

В этом случае:

создай минимальный UI entry point только настолько, насколько необходимо для существующей ServiceRecord architecture.

Перед созданием обязательно используй существующие:

- form components
- validation
- API
- service
- UI patterns

Не дублируй backend logic.

Если полноценный create flow требует отдельного архитектурного решения, НЕ импровизируй.

Вместо этого:

- реализуй только visibility state;
- зафиксируй отсутствие create UI как remaining product gap.

Но если существующая ServiceRecord creation API и логика уже позволяют безопасно добавить существующий UI flow — используй их.

==================================================
8. SERVICE RECORD DATA
==================================================

НЕ добавляй новые поля.

Используй существующую модель.

Если существующая форма требует поля:

- performedAt
- mileage
- workDescription
- partsDescription
- recommendations
- totalPrice
- currency
- service

используй существующие validation rules.

НЕ ослабляй required/optional constraints.

НЕ создавай "быструю пустую запись".

Результат должен содержать реальные данные, введённые оператором.

==================================================
9. APPOINTMENT ↔ SERVICE RECORD
==================================================

ServiceRecord должен быть связан с текущим Appointment существующим механизмом.

Не создавать новую relation.

Не менять Prisma schema.

При создании:

ServiceRecord.appointmentId = current Appointment

если это соответствует существующему backend pattern.

Также обязательно сохранять существующие:

- Customer relation
- Vehicle relation
- Service relation
- tenant ownership

==================================================
10. TENANT ISOLATION — CRITICAL
==================================================

Не доверять tenantId из frontend.

Использовать существующий server-side tenant context.

Проверить:

Appointment
→ ServiceRecord

отношения.

Нельзя создать ServiceRecord:

- для Appointment другого tenant;
- для Vehicle другого tenant;
- для Customer другого tenant;
- для Service другого tenant.

Использовать существующие:

assertRelationsOwnedAndActive
assertAppointmentConsistency
и другие существующие tenant-safe helpers,

если они уже являются частью ServiceRecord creation flow.

НЕ дублировать эти проверки.

==================================================
11. DUPLICATE SAFETY
==================================================

До создания ServiceRecord проверить, существует ли уже запись для Appointment.

Если ServiceRecord уже существует:

- не создавать новый;
- показать существующий результат;
- обновить UI.

UI должен защищать от:

- double click;
- повторного submit;
- race condition настолько, насколько это возможно в существующей архитектуре.

Не реализовывать общую distributed idempotency system.

Это отдельный будущий gap.

==================================================
12. LOADING / ERROR / SUCCESS
==================================================

Использовать существующие UI patterns проекта.

Во время создания:

- кнопка disabled;
- loading indicator.

При ошибке:

- показать реальную ошибку;
- НЕ показывать fake success;
- сохранить введённые данные, если существующий form pattern это позволяет.

После успеха:

- закрыть form/dialog, если это существующий pattern;
- обновить Appointment context;
- warning исчезает;
- появляется нормальный ServiceRecord state;
- пользователь может открыть историю/результат.

==================================================
13. NAVIGATION
==================================================

Использовать существующий routing.

Не добавлять новый routing library.

Не делать масштабный URL refactor.

Если существующий ServiceRecord/Vehicle history имеет route:

использовать его.

Если отдельного route нет:

использовать существующий Appointment context.

НЕ создавать новый большой экран только ради этого prompt.

==================================================
14. APPOINTMENT LIST
==================================================

Проверь, нужно ли показывать этот статус в Appointment list.

Приоритет:

1. Appointment Detail/context — ОБЯЗАТЕЛЬНО.

2. Appointment list — только если это легко и естественно реализуется существующим UI pattern.

Не перегружай список.

Если добавление warning в list требует значительного refactor:

НЕ делать.

Зафиксировать как future UX enhancement.

==================================================
15. VEHICLE HISTORY
==================================================

Не менять существующую Vehicle Service History архитектуру.

После создания ServiceRecord он должен автоматически появляться в существующей истории благодаря существующему data flow.

Если для этого требуется новый endpoint/query:

сначала проверь существующий.

Не дублировать.

==================================================
16. CLIENT HISTORY
==================================================

То же самое для Client Detail.

Не создавать новую историю.

Не менять существующий Client Detail Service History.

После создания ServiceRecord существующий UI должен видеть его через текущую архитектуру.

==================================================
17. TESTS
==================================================

Добавить regression tests там, где это возможно в существующей тестовой архитектуре.

Минимальные сценарии:

### Test 1

COMPLETED Appointment
+
ServiceRecord exists

→ no missing-result warning.

### Test 2

COMPLETED Appointment
+
no ServiceRecord

→ missing-result state is detected.

### Test 3

Create ServiceRecord for valid Appointment

→ ServiceRecord linked to correct Appointment.

### Test 4

Create ServiceRecord with foreign-tenant Appointment

→ rejected.

### Test 5

Create ServiceRecord with foreign-tenant Vehicle/Customer/Service

→ rejected by existing relation validation.

### Test 6

Attempt duplicate ServiceRecord creation for same Appointment

→ existing behavior prevents accidental duplicate, or the test documents the current safe behavior.

Do NOT create frontend test infrastructure if none exists.

Use existing backend/service test patterns.

==================================================
18. REGRESSION
==================================================

После изменений обязательно проверить:

- Customer Request tests
- Appointment tests
- ServiceRecord tests
- tenant isolation
- existing full test suite

Ничего существующего не должно регрессировать.

==================================================
19. VALIDATION
==================================================

Обязательно выполнить:

TypeScript

Build

Full test suite

Expected baseline:

1224/1224

Если добавлены тесты:

1224 + new tests

Все должны PASS.

==================================================
20. DOCUMENTATION
==================================================

Создай:

docs/final-reports/final-report-33.md

Используй формат:

# Final Report — Prompt 33: Service Completion Visibility

## Validation

TypeScript:
Build:
Tests:

## Implemented

- ...

## Completed Appointment Without ServiceRecord

- ...

## Completed Appointment With ServiceRecord

- ...

## ServiceRecord Creation

- ...

## API Changes

- ...

## Prisma Changes

- ...

## Tenant Isolation

- ...

## Tests Added

- ...

## Existing Architecture Reused

- ...

## Remaining Product Gaps

- ...

## Git

Commit:
Message:
Pushed:

## Screenshot Validation

Performed / Not performed

==================================================
21. GIT
==================================================

После успешной реализации:

создай один feature commit.

Пример commit message:

feat: surface missing service completion

После этого НЕ делай force push.

Если repository настроен на origin/master:

push обычным:

git push

Не менять origin/main.

==================================================
22. НЕ ДЕЛАТЬ
==================================================

В Prompt 33 категорически НЕ делать:

- WorkOrder
- Invoice
- Payment
- Inventory
- Technician
- new Prisma models
- Prisma migration без необходимости
- new Appointment statuses
- automatic ServiceRecord creation on COMPLETED
- automatic fake/empty service records
- AI
- LLM
- Telegram
- WhatsApp
- CRM
- Calendar integration
- SMS
- Billing
- subscription
- global redesign
- App Shell redesign
- new design system
- URL persistence refactor
- appointment date-range filter
- Operations redesign

==================================================
23. STOP CONDITION
==================================================

После выполнения остановись.

Если:

TypeScript PASS
Build PASS
Tests PASS

не переходи автоматически к Prompt 34.

Не начинай WorkOrder.

Не начинай Invoice.

Не начинай Payment.

Не начинай Inventory.

Сначала сформируй Final Report и дождись review.

==================================================
FINAL PRODUCT PRINCIPLE
==================================================

Главный принцип Prompt 33:

НЕ создавать данные ради того, чтобы система выглядела заполненной.

Если Appointment завершён, но фактический результат обслуживания не внесён, система должна честно показать:

"Результат обслуживания не зафиксирован."

И дать оператору понятный способ внести реальный результат.

ServiceRecord остаётся единственным существующим источником факта выполненного обслуживания.

STOP.
