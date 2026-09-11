# Prompt 32 — Service Completion Domain Audit & Design

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

=== PROMPT 32 — SERVICE COMPLETION DOMAIN AUDIT & DESIGN ===

ROЛЬ

Ты — senior product architect + senior full-stack engineer, работающий внутри существующего проекта Autoservise.

Текущий продукт уже имеет рабочий operational flow:

Conversation
→ Customer Request
→ Client
→ Vehicle
→ Appointment
→ Operations

Последний завершённый этап:

Prompt 31 — Operational Flow UX Hardening

Git:
- 8b75e9b — feat: operational flow UX hardening
- 9759a5c — docs: preserve prompt 31 verbatim and add final report 31

Validation:
- TypeScript PASS
- Build PASS
- Tests 1224/1224 PASS
- tenant isolation regression tests PASS

ВАЖНО:

Prompt 32 — это ПЕРВИЧНО АУДИТ И ПРОЕКТИРОВАНИЕ.

НЕ начинай сразу создавать WorkOrder.

НЕ создавай Prisma models до завершения аудита.

НЕ реализуй UI только ради того, чтобы "что-то сделать".

Цель Prompt 32:

определить минимальную, правильную и расширяемую доменную модель для следующего реального бизнес-процесса автосервиса:

Appointment
→ фактическое обслуживание
→ выполненные работы
→ результат обслуживания
→ итоговая стоимость
→ история обслуживания автомобиля
→ возможность последующего повторного обращения.

--------------------------------------------------
1. ИЗУЧИ ТЕКУЩУЮ СИСТЕМУ
--------------------------------------------------

Перед любыми изменениями тщательно изучи существующий код.

Обязательно найди и проанализируй:

### Domain / Prisma

- Client
- Vehicle
- CustomerRequest
- Conversation
- Appointment
- существующие relations
- существующие enums
- существующие status fields
- существующие timestamps
- tenantId patterns

### Backend

Найди:

- Appointment service
- CustomerRequest service
- Client service
- Vehicle service
- существующие API endpoints
- validation schemas
- tenant isolation helpers
- relation validation helpers
- error handling patterns

### Frontend

Найди:

- Appointment screens
- Appointment context/detail UI
- Client Detail
- Vehicle context
- Request Detail
- Conversation Detail
- existing service/history UI, если он уже существует
- reusable form/dialog/card/table components

### Tests

Изучи существующие:

- appointment tests
- request tests
- client tests
- vehicle tests
- tenant isolation tests
- integration/e2e tests

--------------------------------------------------
2. ГЛАВНЫЙ ВОПРОС
--------------------------------------------------

Определи:

Что в текущей системе уже существует для фиксации ФАКТИЧЕСКОГО результата обслуживания?

Не путай:

Appointment
с
фактически выполненной работой.

Appointment означает:

"клиент записан на обслуживание".

Но после визита необходимо уметь ответить:

- приехал ли клиент;
- что реально сделали;
- какие работы были выполнены;
- какие работы не были выполнены;
- какие рекомендации появились;
- сколько это стоило;
- что произошло с автомобилем;
- когда автомобиль обслуживался;
- что было сделано в прошлый раз.

Проверь, существует ли уже такая модель или функциональность.

Если существует — НЕ дублируй её.

--------------------------------------------------
3. AUDIT BEFORE IMPLEMENTATION
--------------------------------------------------

Составь внутренний audit matrix:

| Requirement | Exists? | Current entity | Current UI/API | Gap |
|---|---|---|---|---|

Проверь минимум:

1. Appointment
2. Service / service catalog
3. WorkOrder
4. ServiceRecord
5. performed work
6. recommended work
7. parts
8. labor
9. price
10. total amount
11. visit status
12. completed date
13. vehicle service history
14. client service history
15. appointment outcome

Не создавай сущность только потому, что она есть в этом списке.

--------------------------------------------------
4. MODEL THE REAL BUSINESS PROCESS
--------------------------------------------------

Опиши минимальный lifecycle.

Предпочтительный conceptual flow:

Appointment
    ↓
Visit
    ↓
Service execution
    ↓
Completion
    ↓
Service history

Но адаптируй его к реально существующей архитектуре.

Отдельно ответь:

Нужен ли:

A. WorkOrder

B. ServiceRecord

C. Appointment outcome/status

D. отдельная Service entity

E. отдельные WorkItem / performed-service records

F. отдельная Part / Inventory entity

G. Invoice

H. Payment

И самое важное:

Какие из них нужны СЕЙЧАС,
а какие должны остаться на ПОТОМ.

--------------------------------------------------
5. MINIMAL DOMAIN PRINCIPLE
--------------------------------------------------

Используй принцип:

"Minimum viable domain model."

Не создавать:

- generic enterprise ERP architecture;
- десятки таблиц;
- premature inventory system;
- полноценную бухгалтерию;
- полноценный склад;
- payment ledger;
- complicated pricing engine.

Если для следующего этапа достаточно:

Appointment
+
ServiceRecord

то НЕ создавай WorkOrder + Invoice + Payment + Inventory одновременно.

Если нужен WorkOrder — объясни ПОЧЕМУ.

--------------------------------------------------
6. IMPORTANT DISTINCTION
--------------------------------------------------

Обязательно различай:

REQUEST

Что клиент хочет.

APPOINTMENT

Когда клиент записан.

WORK ORDER

Что сервис фактически открыл в работу.

SERVICE RECORD

Что фактически было сделано и осталось в истории автомобиля.

INVOICE

Что сервис предъявил к оплате.

PAYMENT

Что клиент фактически оплатил.

Не смешивай эти понятия в одну сущность.

--------------------------------------------------
7. SERVICE HISTORY
--------------------------------------------------

Отдельно исследуй, как лучше представить историю обслуживания.

История должна быть привязана прежде всего к:

Vehicle

а не только к Client.

Потому что один клиент может иметь несколько автомобилей.

Определи:

- как получить service history конкретного Vehicle;
- как показать её в Client Detail;
- нужно ли отдельное /vehicles/:id/history;
- можно ли использовать существующий Vehicle context;
- какие поля реально нужны для первой версии.

Минимально потенциально полезные данные:

- date
- service type
- mileage, если существует;
- performed work
- recommendations
- total amount, если существует;
- source Appointment
- source Request

Но НЕ добавляй поля, которых нет необходимости поддерживать сейчас.

--------------------------------------------------
8. APPOINTMENT COMPLETION
--------------------------------------------------

Исследуй текущие Appointment statuses.

Определи:

можно ли существующий Appointment status расширить минимальным outcome lifecycle.

Например концептуально:

SCHEDULED
CONFIRMED
COMPLETED
CANCELLED
NO_SHOW

Но:

НЕ вводи эти значения автоматически.

Сначала проверь существующие enums.

Если существующие статусы уже покрывают lifecycle — используй их.

Если нет — предложи минимальное изменение.

--------------------------------------------------
9. WORK ORDER DECISION
--------------------------------------------------

Особенно тщательно ответь:

Нужен ли WorkOrder уже сейчас?

Рассмотри два варианта:

### Option A

Appointment
→ ServiceRecord

### Option B

Appointment
→ WorkOrder
→ ServiceRecord

Сравни:

- complexity
- future extensibility
- Prisma complexity
- UI complexity
- operator workflow
- data integrity
- migration cost

Выбери один вариант.

Если WorkOrder не нужен сейчас — прямо зафиксируй:

"WorkOrder deferred."

Если нужен — объясни минимальную модель.

--------------------------------------------------
10. INVOICE / PAYMENT / INVENTORY
--------------------------------------------------

В рамках Prompt 32 НЕ реализовывать:

- Invoice
- Payment
- Inventory
- Warehouse
- Parts catalog
- Technician management

Но определить:

какие будущие сущности должны логически подключаться к ServiceRecord/WorkOrder.

Пример:

ServiceRecord
├── performed work
├── recommendations
├── parts
└── financial summary

НЕ создавай эти сущности сейчас.

--------------------------------------------------
11. TENANT ISOLATION
--------------------------------------------------

Любая будущая модель должна поддерживать tenant isolation.

Определи:

- где должен находиться tenantId;
- какие foreign keys должны проверяться;
- какие relations нельзя позволять cross-tenant;
- какие server-side assertions понадобятся.

Не реализовывай новые модели, если для этого ещё нет архитектурного решения.

--------------------------------------------------
12. DATA OWNERSHIP
--------------------------------------------------

Определи ownership каждого объекта.

Например:

CustomerRequest
→ Client

Vehicle
→ Client

Appointment
→ Client
→ Vehicle
→ Request

ServiceRecord
→ Vehicle
→ Appointment

Если другая схема лучше — объясни почему.

Особенно важно избежать ситуации, когда ServiceRecord можно случайно создать:

- для чужого автомобиля;
- для чужого клиента;
- для чужого Appointment.

--------------------------------------------------
13. UI IMPACT
--------------------------------------------------

Не реализуй полноценный новый UI.

Только опиши необходимые будущие точки входа:

Например:

Appointment Detail
→ "Начать обслуживание"

Appointment Detail
→ "Завершить обслуживание"

Vehicle Detail
→ "История обслуживания"

Service Record
→ performed work
→ recommendations
→ total

Но не создавай эти экраны в Prompt 32.

--------------------------------------------------
14. MIGRATION STRATEGY
--------------------------------------------------

Если будут предложены новые Prisma models:

опиши migration strategy.

Учитывай:

- существующие production-like data;
- nullable vs required fields;
- backfill;
- existing Appointment records;
- existing Requests;
- existing Vehicles;
- tenant isolation.

Не выполнять migration без необходимости.

Если implementation НЕ требуется для Prompt 32 — НЕ запускать migration.

--------------------------------------------------
15. ACCEPTANCE CRITERIA
--------------------------------------------------

Prompt 32 считается успешным, если после анализа у нас есть однозначный ответ:

1. Что является фактом записи?
2. Что является фактом обслуживания?
3. Где хранится результат обслуживания?
4. Как результат связан с Vehicle?
5. Как результат связан с Appointment?
6. Нужен ли WorkOrder?
7. Нужен ли ServiceRecord?
8. Что делать сейчас?
9. Что отложить?
10. Как будет выглядеть следующий implementation prompt?

--------------------------------------------------
16. IMPLEMENTATION RULE
--------------------------------------------------

По умолчанию:

НЕ изменяй код.

НЕ изменяй Prisma schema.

НЕ создавай migration.

НЕ создавай новые endpoints.

НЕ создавай новые страницы.

НЕ создавай новые UI components.

Исключение:

Если в ходе аудита обнаружится критическая ошибка существующей модели, которая мешает корректно определить следующий этап, НЕ исправляй её автоматически.

Просто зафиксируй её в отчёте.

--------------------------------------------------
17. DOCUMENTATION
--------------------------------------------------

Создай:

docs/final-reports/

Final Report для Prompt 32.

Если в проекте есть подходящий architecture/design documentation file — можно добавить отдельный документ, но не переписывай существующую документацию без необходимости.

--------------------------------------------------
18. FINAL REPORT FORMAT
--------------------------------------------------

Используй строго следующий формат:

## Final Report — Prompt 32: Service Completion Domain Audit & Design

### Validation

TypeScript: PASS/NOT RUN
Build: PASS/NOT RUN
Tests: X/X or NOT RUN

Объясни, почему tests/build запускались или не запускались.

### Current Domain Audit

#### Appointment

...

#### Customer Request

...

#### Vehicle

...

#### Existing Service / History

...

### Audit Matrix

| Requirement | Exists? | Current Entity | Current UI/API | Gap |
|---|---|---|---|---|

### Core Domain Decision

#### Appointment

...

#### WorkOrder

...

#### ServiceRecord

...

#### Service

...

#### Work Items

...

#### Parts / Inventory

...

#### Invoice

...

#### Payment

...

### Recommended Minimal Model

Покажи рекомендуемый минимальный набор сущностей.

Для каждой:

- purpose
- ownership
- required relations
- critical fields
- tenant isolation

### Lifecycle

Покажи:

Appointment
→ ...
→ ...
→ ...

### Vehicle Service History

Опиши:

- source
- ownership
- required data
- future UI

### Deferred

Явно перечисли всё, что НЕ нужно делать сейчас.

### Risks / Existing Gaps

...

### Recommended Prompt 33

Сформулируй, что должен делать следующий implementation prompt.

НЕ выполняй Prompt 33.

### Prisma Changes

NONE

если действительно никаких изменений.

### API Changes

NONE

если действительно никаких изменений.

### Git

Если код не менялся:

No code commit required.

### Screenshot Validation

Not performed.

STOP.

==================================================
CRITICAL STOP CONDITION
==================================================

После завершения аудита ОСТАНОВИСЬ.

НЕ создавай WorkOrder.

НЕ создавай ServiceRecord.

НЕ создавай Invoice.

НЕ создавай Payment.

НЕ создавай Inventory.

НЕ создавай Technician.

НЕ создавай Prisma migration.

НЕ начинай Prompt 33.

Сначала дождись review этого отчёта.
