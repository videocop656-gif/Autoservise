# Prompt 27 — Service Workflow & Request Lifecycle Audit v1

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# PROMPT 27 — Service Workflow & Request Lifecycle Audit v1

## Контекст проекта

Продолжаем разработку production-oriented SaaS для администратора автосервиса.

Уже реализованы:

* Dashboard
* `/operations` — Рабочая очередь
* `/requests` — Customer Requests + Request Detail
* `/conversations` — Conversations + Conversation Detail
* `/clients` — Clients + Client Detail
* `/vehicles` — Vehicle Context v1
* Service History context

Последовательность последних шагов:

* Prompt 24 — Customer Requests
* Prompt 25 — Operational Work Queue
* Prompt 26 — Vehicle Context & Service History

Сейчас приложение уже имеет достаточно много сущностей и cross-navigation.

Поэтому следующий шаг — **не создавать очередную сущность автоматически**.

---

# ГЛАВНАЯ ЦЕЛЬ PROMPT 27

Нужно понять:

> Что происходит с Customer Request после того, как она появилась в системе?

Нас интересует реальный operational lifecycle:

```text
входящее обращение
      ↓
обработка администратором
      ↓
уточнение потребности
      ↓
следующее действие
      ↓
обслуживание / результат
      ↓
завершение
```

Но это только концептуальная схема.

**НЕ ПРИНИМАЙ ЕЁ ЗА СУЩЕСТВУЮЩУЮ БИЗНЕС-ЛОГИКУ.**

Сначала изучи реальный код, Prisma и API.

---

# STEP 1 — АУДИТ PRISMA

Изучи все модели, которые могут участвовать в lifecycle Customer Request.

Минимум:

* CustomerRequest
* Conversation
* Message
* Customer
* Vehicle
* ServiceHistory
* AiEscalation
* AiLog
* любые appointment / work order / job / service / invoice / payment / technician / schedule модели, если они реально существуют.

Для каждой модели определить:

* назначение;
* реальные поля;
* status;
* relations;
* createdAt;
* updatedAt;
* foreign keys.

Особенно внимательно проверь:

### CustomerRequest

Какие реальные статусы существуют сейчас?

В предыдущем аудите были:

```text
NEW
IN_PROGRESS
WAITING_CUSTOMER
QUALIFIED
CONVERTED
CLOSED
CANCELLED
```

Но **не полагайся только на этот список**.

Проверь актуальный код/schema и зафиксируй реальное состояние проекта.

---

# STEP 2 — НАЙТИ ВСЕ LIFECYCLE SIGNALS

Ищи в коде:

* status transitions;
* PATCH endpoints;
* conversion logic;
* close/reopen logic;
* request creation;
* conversation creation;
* escalation creation;
* service history creation;
* links между request и service history;
* links между request и vehicle;
* links между request и conversation.

Особенно важно найти:

> Что означает `CONVERTED` в текущем приложении?

Не предполагай.

Нужно выяснить, существует ли реальное действие после `CONVERTED`.

Например:

* создаётся другая сущность;
* создаётся service record;
* меняется только статус;
* существует отдельный workflow;
* ничего больше не происходит.

---

# STEP 3 — АУДИТ API

Найди все endpoints, которые участвуют в request lifecycle.

Минимум:

```text
GET /api/customer-requests
POST /api/customer-requests
PATCH /api/customer-requests/:id
GET /api/conversations
POST /api/conversations/:id/messages
POST /api/channels/:id/messages/:id/send
GET /api/service-history
POST /api/service-history
```

Но используй только реально существующие endpoints.

Также проверь любые endpoints для:

* appointments;
* work orders;
* jobs;
* invoices;
* payments;
* technicians;
* scheduling;
* service operations.

Если их нет — зафиксируй это.

---

# STEP 4 — ПРОВЕРЬ, ЕСТЬ ЛИ РЕАЛЬНЫЙ "NEXT STEP"

Главный вопрос:

После изменения CustomerRequest status:

```text
NEW
→ IN_PROGRESS
→ QUALIFIED
→ CONVERTED
```

происходит ли что-нибудь ещё?

Или система сейчас заканчивается на Request lifecycle?

Это критически важно.

Если `CONVERTED` является просто конечным статусом без downstream entity:

**не создавай Work Order.**

Если существует реальная downstream сущность:

исследуй её lifecycle.

---

# STEP 5 — AUDIT SERVICE HISTORY

Очень важно отличить:

### Service History

от

### Work Order / Service Job

Service History может быть:

* фактом уже выполненной работы;
* журналом обслуживания;
* историческим событием.

Это НЕ обязательно рабочая сущность.

Проверь:

* кто создаёт ServiceHistory;
* когда;
* можно ли редактировать;
* можно ли создавать её вручную;
* связана ли она с Request;
* связана ли она с Vehicle;
* существует ли status;
* является ли она результатом завершённой работы.

Не превращай Service History в Work Order без доказательств.

---

# STEP 6 — PRODUCT DECISION

После аудита выбери один из вариантов.

## Вариант A — Downstream workflow уже существует

Если в системе уже есть реальная сущность после Customer Request:

например:

* WorkOrder;
* Appointment;
* Job;
* ServiceOrder;
* другая реальная сущность;

тогда реализуй **следующий operational step** вокруг неё.

Но используй существующую модель/API.

---

## Вариант B — Downstream workflow НЕ существует

Если после CustomerRequest нет реальной сущности:

**НЕ СОЗДАВАЙ ЕЁ.**

В этом случае Prompt 27 должен улучшить существующий Request lifecycle без создания новой бизнес-сущности.

Например:

* сделать status transitions более понятными;
* добавить корректные next actions;
* улучшить Request Detail;
* сделать operational flow между Request → Conversation → Client → Vehicle → Service History;
* показать администратору, что реально можно сделать дальше.

Но только на основе существующего API.

---

# STEP 7 — ЕСЛИ НЕТ WORK ORDER / APPOINTMENT

Если аудит показал, что downstream сущности отсутствуют, НЕ создавай:

* WorkOrder model;
* Appointment model;
* Job model;
* Schedule model;
* Invoice model;
* Payment model.

Это будет отдельный продуктовый этап.

Вместо этого сделай **Request Lifecycle v2**.

---

# STEP 8 — REQUEST DETAIL: NEXT ACTION

Если существующая модель позволяет определить next action, улучшить Request Detail.

Цель:

Администратор открывает заявку и понимает:

> "Что я могу сделать сейчас?"

Например, только если это реально поддерживается:

### NEW

Действие:

**Взять в работу**

→ существующий PATCH status.

### IN_PROGRESS

Действия:

* открыть разговор;
* изменить статус;
* другие реальные действия.

### WAITING_CUSTOMER

Действие:

* открыть Conversation;
* продолжить коммуникацию.

### QUALIFIED

Показать следующий существующий operational step.

### CONVERTED

Показать, куда реально ведёт conversion.

### CLOSED

Показать финальное состояние.

### CANCELLED

Показать финальное состояние.

Не создавай действия, которых нет в API.

---

# STEP 9 — STATUS TRANSITIONS

Проверь существующую backend validation.

Нельзя создавать frontend transitions, которые backend не разрешает.

Составь фактическую таблицу:

| Current          | Available next statuses |
| ---------------- | ------------------------ |
| NEW              | реальные                 |
| IN_PROGRESS      | реальные                 |
| WAITING_CUSTOMER | реальные                 |
| QUALIFIED        | реальные                 |
| CONVERTED        | реальные                 |
| CLOSED           | реальные                 |
| CANCELLED        | реальные                 |

Используй реальные backend rules.

Если backend не ограничивает transitions:

не придумывай ограничения только на frontend.

---

# STEP 10 — CONVERSATION CONNECTION

Request уже связан с Conversation через существующее:

`Conversation.customerRequestId`

Проверь:

* как создаётся Conversation;
* можно ли создать conversation из Request;
* можно ли отправить сообщение;
* можно ли вернуться из Conversation в Request;
* можно ли изменить Request status из Conversation, если это уже поддерживается.

Если какие-либо cross-links отсутствуют, реализуй их только если это возможно через существующие routes/API.

---

# STEP 11 — SERVICE HISTORY CONNECTION

Проверь реальную связь:

```text
Request → Vehicle → Service History
```

и прямые relations, если существуют.

Не создавай:

```text
Request → ServiceHistory
```

если такой relation отсутствует.

Если Service History появляется только после завершения обслуживания и система пока не имеет такой workflow:

зафиксируй это как product gap.

Не симулируй процесс.

---

# STEP 12 — OPERATIONS CONNECTION

Рабочая очередь уже существует.

Проверь, что Request lifecycle логично связан с `/operations`.

Например:

```text
NEW Request
      ↓
Рабочая очередь
      ↓
Request Detail
      ↓
Conversation
      ↓
Status transition
```

Это только пример.

Используй фактическую логику.

Если после реализации Request lifecycle меняется отображение в Operations — обнови его минимально.

Не переписывай Operations.

---

# STEP 13 — НЕ СОЗДАВАТЬ "PROCESS THEATER"

Не делай визуальные workflow только ради ощущения сложной системы.

Запрещены без реальной backend поддержки:

* fake progress bar;
* 1/5 → 2/5 → 3/5 stages;
* fake checklist;
* "готово на 70%";
* fake SLA;
* fake deadlines;
* fake technician assignment;
* fake appointment;
* fake service bay;
* fake invoice;
* fake payment status.

Каждый UI state должен иметь источник в реальных данных.

---

# STEP 14 — ЕСЛИ НУЖЕН НОВЫЙ BACKEND

Предпочтение:

**No backend changes.**

Если backend действительно не поддерживает нужное действие:

не создавай новую бизнес-логику самостоятельно.

В Final Report укажи:

* какой workflow gap обнаружен;
* какая модель отсутствует;
* какой endpoint отсутствует;
* что понадобится для следующего этапа.

Prompt 27 может завершиться **без значительных изменений**, если аудит покажет, что текущая модель не поддерживает следующий workflow.

Это допустимый и даже полезный результат.

---

# STEP 15 — N+1

Не добавляй запросы на каждый Request/Conversation/Vehicle.

Для списков использовать:

* existing pagination;
* bulk/reference data;
* existing includes;
* batch queries.

Для detail допустимы несколько независимых запросов.

Не строить:

```text
for each request:
  load conversation
  load customer
  load vehicle
  load service history
```

---

# STEP 16 — UX

Главная UX-цель:

Администратор должен понимать состояние заявки без необходимости разбираться в технических статусах.

Можно использовать human-readable labels.

Но внутренние значения должны оставаться реальными:

```text
NEW
IN_PROGRESS
WAITING_CUSTOMER
...
```

Не заменяй backend enum новыми значениями.

---

# STEP 17 — НЕ ДЕЛАТЬ

В Prompt 27 запрещено:

* новая Prisma business entity без предварительного обоснования;
* WorkOrder;
* Appointment;
* Scheduling;
* Technician workflow;
* Invoice;
* Payments;
* Parts;
* Inventory;
* OBD;
* notifications;
* email/SMS automation;
* AI automation;
* background jobs;
* cron;
* fake workflow;
* fake data;
* analytics dashboard.

---

# STEP 18 — VALIDATION

После реализации:

```bash
npx tsc --noEmit
```

затем:

```bash
npm run build
```

и существующий test suite.

Минимально проверить:

1. Request creation.
2. Request status change.
3. Existing Request Detail.
4. Conversation link.
5. Client link.
6. Vehicle link.
7. Service History context.
8. Operations screen.
9. Existing Conversations.
10. Existing Clients.
11. Existing Vehicles.
12. No N+1.
13. No fake data.
14. TypeScript PASS.
15. Build PASS.
16. Tests PASS.

---

# STEP 19 — GIT

Создай отдельный commit только если код реально изменён.

Если реализован Request Lifecycle v2:

```text
feat: improve request lifecycle v2
```

Если после аудита изменений не потребовалось:

не создавай пустой commit.

---

# FINAL REPORT

Подготовь:

## Final Report — Prompt 27: Service Workflow & Request Lifecycle Audit v1

### 1. Audit Summary

Что найдено.

### 2. CustomerRequest Lifecycle

Покажи реальные statuses и transitions.

### 3. Downstream Entities

Есть ли:

* Work Order
* Appointment
* Job
* Service Order
* Invoice
* Payment
* Technician workflow

Для каждого:

**EXISTS / DOES NOT EXIST**

### 4. `CONVERTED` Meaning

Что реально означает `CONVERTED` в текущем коде.

### 5. Service History

Как она реально связана с Vehicle / Request.

### 6. Product Decision

Одно из:

**A. Existing downstream workflow implemented**

или

**B. No downstream workflow exists; Request Lifecycle v2 implemented**

или

**C. No implementation justified; product gap documented**

### 7. Implementation

Что реально изменено.

### 8. Files Changed

Полный список.

### 9. API Used

Список endpoints.

### 10. Backend / Prisma

Указать:

* backend changes;
* Prisma changes;
* migrations.

### 11. N+1 Audit

Подробно.

### 12. Cross-navigation

Проверить:

* Request → Conversation
* Request → Client
* Request → Vehicle
* Conversation → Request
* Vehicle → Request
* Operations → Request

### 13. Validation

Реальные результаты:

* TypeScript
* Build
* Tests

### 14. Git

Commit hash + message.

### 15. Limitations / Product Gaps

Отдельно перечислить реальные ограничения.

Особенно:

если для полноценного service workflow отсутствуют WorkOrder / Appointment / Scheduling / Technician модели — зафиксировать это здесь.

### 16. Screenshot

Если screenshot validation не проводилась:

> No screenshot validation performed.

Не утверждай визуальную проверку без screenshot.

---

# STOP CONDITION

После Final Report остановись.

Не переходи к Prompt 28.

Не создавай новые business entities "на будущее".

Не добавляй scheduling, work orders, appointments или invoices автоматически.

Главный результат Prompt 27:

**понять реальный lifecycle заявки и аккуратно довести существующую модель до следующего operational шага — только там, где текущие данные и API это действительно позволяют.**
