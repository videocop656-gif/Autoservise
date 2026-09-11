# Prompt 29 — Service Execution & Post-Appointment Audit v1

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# PROMPT 29 — SERVICE EXECUTION & POST-APPOINTMENT AUDIT V1

## CONTEXT

Мы продолжаем разработку production-oriented SaaS для AI-администратора автосервиса.

Уже реализованы:

* Dashboard
* `/operations` — Рабочая очередь
* `/requests` — Customer Requests
* Request Detail + Request Lifecycle v2
* `/clients` — Clients
* Client Detail
* `/vehicles` — Vehicle Context
* Vehicle Detail
* `/conversations` — Conversations
* Conversation Detail
* `/appointments` — Appointments
* Appointment Detail
* Service History

Последние результаты:

### Prompt 27

Установлено:

* `CustomerRequest` имеет реальный lifecycle;
* `CONVERTED` не запускает отдельный downstream workflow;
* WorkOrder / Job / Service Order не существуют как подтверждённые downstream entities.

### Prompt 28

Установлено:

* Appointment — реальная запись клиента на конкретную услугу;
* Appointment имеет lifecycle:

  * `SCHEDULED`
  * `CONFIRMED`
  * `IN_PROGRESS`
  * `COMPLETED`
  * `CANCELLED`
  * `NO_SHOW`
* `Appointment` имеет реальные связи с Customer, Vehicle, Service;
* существует реальный `ServiceRecord.appointmentId`;
* отдельного Conversation ↔ Appointment relation нет;
* после `COMPLETED` отдельный downstream workflow пока не определён.

---

# ГЛАВНАЯ ЦЕЛЬ

Определить:

> Что реально происходит в системе после того, как Appointment переходит в `IN_PROGRESS` и затем `COMPLETED`?

Нужно установить, существует ли уже полноценный механизм фиксации выполненной услуги.

Например:

```text
Appointment
    ↓
IN_PROGRESS
    ↓
работа выполнена
    ↓
ServiceRecord
    ↓
стоимость / результат / заметки
    ↓
COMPLETED
```

Но эта схема является **только гипотезой**.

Не считай её существующей архитектурой.

---

# CRITICAL RULE

## НЕ СОЗДАВАЙ НОВЫЕ BUSINESS ENTITIES

В этом prompt запрещено автоматически создавать:

* WorkOrder;
* Job;
* JobCard;
* ServiceOrder;
* Invoice;
* Payment;
* Parts;
* Inventory;
* TechnicianAssignment;
* RepairStage;
* Schedule;
* Billing;
* новую Prisma model.

Даже если кажется, что они необходимы автосервису.

Сначала нужно понять существующую систему.

---

# STEP 1 — PRISMA AUDIT

Изучи актуальную Prisma schema.

Особенно подробно исследуй:

* Appointment;
* ServiceRecord;
* Service;
* Customer;
* Vehicle;
* CustomerRequest;
* Conversation;
* Message;
* AiEscalation;
* любые billing/payment/invoice models;
* любые employee/technician models;
* любые parts/inventory models.

Для `ServiceRecord` установить:

* все поля;
* status, если существует;
* customer relation;
* vehicle relation;
* appointment relation;
* service relation;
* date/time;
* description;
* mileage;
* price/cost;
* notes;
* createdAt;
* updatedAt;
* любые дополнительные поля.

---

# STEP 2 — SERVICE RECORD SEMANTICS

Критически важно определить:

> Что такое `ServiceRecord` в текущей системе?

Проверить код и определить, является ли это:

### A

Исторической записью о уже выполненной услуге.

### B

Рабочей записью текущей услуги.

### C

Одновременно и рабочей, и исторической записью.

### D

Другим объектом.

Не выбирать вариант по бизнес-логике.

Вывод должен быть подтверждён:

* Prisma;
* API;
* frontend;
* create/update flows.

---

# STEP 3 — FIND ALL SERVICE RECORD CREATION FLOWS

Найди весь код, где вызывается создание `ServiceRecord`.

Ищи:

```text
POST /api/service-history
```

или фактический endpoint.

Найди все места, откуда он вызывается:

* UI;
* backend;
* seed;
* tests;
* scripts;
* автоматические workflows.

Особенно важно:

> Создаётся ли ServiceRecord автоматически при `Appointment → COMPLETED`?

Если да:

покажи точную цепочку.

Если нет:

зафиксируй это.

---

# STEP 4 — APPOINTMENT → SERVICE RECORD

Исследуй существующий relation:

```text
ServiceRecord.appointmentId
```

Определи:

* optional или required;
* кто его устанавливает;
* когда;
* есть ли backend validation;
* можно ли изменить;
* можно ли удалить ServiceRecord;
* можно ли создать ServiceRecord без Appointment.

Особенно проверить:

### Может ли один Appointment иметь несколько ServiceRecord?

Не предполагай cardinality.

Определи её из Prisma и backend.

---

# STEP 5 — COMPLETED TRANSITION

Найди реальный backend code для:

```text
PATCH /api/appointments/:id
```

или фактического endpoint.

Исследуй:

```text
status = COMPLETED
```

Что происходит?

Возможные варианты:

### Variant 1

Только меняется статус Appointment.

### Variant 2

Создаётся ServiceRecord.

### Variant 3

Обновляется существующий ServiceRecord.

### Variant 4

Происходит другой существующий workflow.

### Variant 5

Backend вообще не делает специальной обработки.

Нужно определить фактический вариант.

---

# STEP 6 — PRICE / COST

Исследовать реальные финансовые поля.

Найти:

* price;
* cost;
* amount;
* total;
* currency;
* discount;
* payment status;
* invoice.

Но только если такие поля реально существуют.

Определить:

> Где сейчас хранится стоимость услуги?

И отдельно:

> Есть ли вообще понятие оплаты?

Если нет:

не создавать его.

---

# STEP 7 — WORK PERFORMED

Проверить, где фиксируется фактически выполненная работа.

Например:

* ServiceRecord.description;
* ServiceRecord.notes;
* Service;
* другие реальные поля.

Определить:

> Можно ли после завершения Appointment записать, что фактически было сделано?

Если можно — показать существующий flow.

Если нельзя — зафиксировать product gap.

---

# STEP 8 — MILEAGE / VEHICLE CONDITION

Проверить, существуют ли реальные поля для:

* mileage;
* odometer;
* vehicle condition;
* inspection result;
* diagnostic result.

Не создавать новые поля.

Если их нет:

документировать отсутствие.

---

# STEP 9 — TECHNICIAN / EMPLOYEE

Проверить, существуют ли:

* Technician;
* Employee;
* Staff;
* assignedUser;
* mechanic;
* responsibleEmployee.

Если существуют:

проверить связь с Appointment / ServiceRecord.

Если нет:

не создавать.

---

# STEP 10 — PARTS / INVENTORY

Проверить, существует ли:

* Part;
* Inventory;
* Stock;
* UsedPart;
* Material;
* расходники.

Если нет:

это product gap, а не задача Prompt 29.

Не создавать inventory system.

---

# STEP 11 — INVOICE / PAYMENT

Проверить, существует ли:

* Invoice;
* Payment;
* Transaction;
* PaymentStatus;
* Billing.

Если существуют:

определить реальные relations:

```text
Appointment
→ Invoice
→ Payment
```

или другую фактическую структуру.

Если отсутствуют:

зафиксировать:

> No billing/payment workflow currently exists.

Не создавать его.

---

# STEP 12 — SERVICE HISTORY SCREEN

Изучи существующую страницу Service History.

Определи:

* как создаётся запись;
* как редактируется;
* какие поля отображаются;
* можно ли открыть конкретную запись;
* можно ли связать её с Appointment;
* есть ли vehicle context;
* есть ли customer context.

Особенно обратить внимание на уже известное ограничение:

`GET /api/service-history` не имеет `appointmentId` filter.

Не исправлять это автоматически.

Сначала определить, нужен ли такой filter для реального workflow.

---

# STEP 13 — APPOINTMENT DETAIL

На основании аудита определить:

Нужно ли расширять Appointment Detail?

Например, если ServiceRecord уже существует:

```text
Appointment
    ↓
Service record
```

можно показать:

* service performed;
* date;
* notes;
* price;
* other real fields.

Но только существующие данные.

Если ServiceRecord создаётся только вручную через отдельный Service History screen:

не симулировать автоматическую связь.

---

# STEP 14 — COMPLETION UX

Если существующий backend позволяет корректно завершить Appointment:

проверь текущий UX.

Администратор должен понимать:

> Что происходит при нажатии "Завершить"?

Если backend только меняет status:

не создавать fake multi-step completion wizard.

Если существующий backend действительно требует данные для completion:

показать их в существующем flow.

---

# STEP 15 — NO FAKE WORKFLOW

Запрещено создавать:

```text
Начать ремонт
↓
Назначить механика
↓
Добавить запчасти
↓
Добавить работы
↓
Рассчитать стоимость
↓
Выставить счёт
↓
Принять оплату
↓
Завершить заказ
```

если такого workflow нет в backend.

Это НЕ цель Prompt 29.

---

# STEP 16 — N+1 AUDIT

Проверить существующие Service History / Appointment flows.

Не допускать:

```text
Appointment list
→ request per appointment
→ service record per appointment
→ customer per appointment
→ vehicle per appointment
```

Использовать existing bulk/reference data.

Для Detail:

* независимые запросы параллельно;
* dependent queries только когда действительно необходимы.

---

# STEP 17 — PRODUCT DECISION

После аудита выбрать одно:

## OPTION A

Existing Service Execution workflow уже существует.

Тогда минимально улучшить UI, чтобы он был доступен администратору.

---

## OPTION B

ServiceRecord существует, но completion workflow не автоматизирован.

Тогда:

* не создавать новую business entity;
* при необходимости улучшить существующий ServiceRecord flow;
* связать Appointment и ServiceRecord только через существующий backend contract;
* не создавать fake WorkOrder.

---

## OPTION C

Appointment заканчивается на `COMPLETED`, а Service History — отдельный исторический механизм.

Тогда:

**не расширять workflow.**

Зафиксировать product gap.

---

## OPTION D

Недостаточно данных для безопасного изменения.

Тогда:

ничего не менять.

Сделать только аудит и Final Report.

Это допустимый результат.

---

# STEP 18 — IMPLEMENTATION SCOPE

Изменять код только если аудит показывает очевидное улучшение без новой бизнес-логики.

Допустимые изменения:

* Appointment Detail;
* Service History UI;
* existing cross-navigation;
* existing status UX;
* existing forms;
* existing labels;
* existing data display.

Недопустимые изменения:

* новые Prisma business entities;
* новые financial systems;
* новые inventory systems;
* новые technician systems;
* новые scheduling engines;
* AI workflow;
* background jobs.

---

# STEP 19 — BACKEND RULE

Предпочтительно:

```text
No backend changes.
No Prisma changes.
No migrations.
```

Если backend modification действительно необходим:

сначала остановись и подробно объясни:

1. почему существующего API недостаточно;
2. какое минимальное изменение необходимо;
3. почему это не создаёт новый business concept.

Не расширяй backend автоматически.

---

# STEP 20 — VALIDATION

После возможных изменений:

```bash
npx tsc --noEmit
npm run build
npm test
```

Используй реальные project-specific commands, если они отличаются.

Проверить минимум:

* Appointment list;
* Appointment Detail;
* status transitions;
* completion;
* Service History;
* Client;
* Vehicle;
* Request;
* Operations;
* Conversations;
* cross-navigation;
* no N+1;
* no fake data.

---

# STEP 21 — GIT

Если код изменён:

создать отдельный commit.

Предпочтительное сообщение:

```text
feat: improve service execution flow
```

Если изменений нет:

не создавать пустой commit.

Push только обычным способом.

No force push.

---

# FINAL REPORT

Создать:

`docs/final-reports/final-report-29.md`

Структура:

## 1. Audit Summary

Что найдено.

## 2. ServiceRecord Data Model

Все важные реальные поля и relations.

## 3. ServiceRecord Semantics

Что означает ServiceRecord.

## 4. Creation Flow

Где и как создаётся ServiceRecord.

## 5. Appointment → ServiceRecord

Фактическая связь и cardinality.

## 6. COMPLETED Behavior

Что реально происходит при переходе Appointment в `COMPLETED`.

## 7. Price / Cost

Есть ли стоимость и где она хранится.

## 8. Work Performed

Как фиксируется выполненная работа.

## 9. Mileage / Vehicle Condition

Какие реальные данные существуют.

## 10. Technician / Employee

Есть или нет.

## 11. Parts / Inventory

Есть или нет.

## 12. Invoice / Payment

Есть или нет.

## 13. Service History Screen

Что реально поддерживается.

## 14. Appointment Detail

Нужно ли его менять и почему.

## 15. Product Decision

Указать:

`A / B / C / D`

## 16. Implementation

Что реально изменено.

## 17. Files Changed

Полный список.

## 18. API Used

Все реально использованные endpoints.

## 19. Backend / Prisma

Явно:

* backend changes;
* Prisma changes;
* migrations.

## 20. N+1 Audit

List + Detail.

## 21. Cross-navigation

Проверить:

* Appointment → Client
* Appointment → Vehicle
* Appointment → Request
* Appointment → Service History
* Client → Appointment
* Vehicle → Appointment
* Request → Appointment
* Service History → Appointment

## 22. Validation

* TypeScript;
* Build;
* Tests.

## 23. Git

Commit + push status.

## 24. Limitations / Product Gaps

Особенно отметить:

* отсутствие WorkOrder;
* отсутствие billing/payment;
* отсутствие technician workflow;
* отсутствие parts/inventory;
* отсутствие автоматического ServiceRecord после completion,

если это действительно обнаружено.

## 25. Screenshot

Указать:

`Screenshot validation performed`

или:

`No screenshot validation performed`

---

# STOP CONDITION

После создания Final Report:

**СТОП.**

Не переходить к Prompt 30.

Не создавать WorkOrder.

Не создавать Invoice.

Не создавать Payment.

Не создавать Inventory.

Не создавать Technician workflow.

Не создавать новые Prisma models.

Сначала дождаться моего review Final Report 29.

Главный результат Prompt 29:

> Мы должны точно знать, что происходит после `Appointment → COMPLETED`, где заканчивается существующий продукт и какой следующий business workflow действительно имеет смысл строить.
