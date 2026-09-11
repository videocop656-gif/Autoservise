# Prompt 30 — End-to-End Operational Flow Audit v1

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# PROMPT 30 — END-TO-END OPERATIONAL FLOW AUDIT V1

## CONTEXT

Мы продолжаем разработку production-oriented SaaS:

**AI-Администратор для автосервисов**

Цель продукта:

> Помочь администратору автосервиса обработать обращение клиента, квалифицировать потребность, записать клиента на обслуживание и сохранить результат обслуживания.

На текущий момент реализованы:

* Authentication
* AppShell
* Dashboard
* Conversations
* Conversation Detail
* Clients
* Client Detail
* Vehicles
* Vehicle Detail
* Customer Requests
* Request Detail
* Request Lifecycle v2
* Operations / Рабочая очередь
* Appointments
* Appointment Detail
* Service History
* Telegram Bot API integration
* AI integration layer, но AI behavior пока намеренно не расширяется

Последний подтверждённый Git commit:

`70fe7bf` — `feat: improve service execution flow`

---

# ГЛАВНАЯ ЦЕЛЬ PROMPT 30

Теперь не создавать новый экран.

Не создавать новую business entity.

Не создавать WorkOrder.

Не создавать Billing.

Не создавать Payment.

Не создавать Inventory.

Не создавать Technician workflow.

Не менять Prisma без крайней необходимости.

Нужно провести **полный End-to-End Audit существующего продукта**.

Главный вопрос:

> Может ли администратор реально провести клиента через основной operational workflow от первого обращения до завершённого обслуживания, используя уже существующие экраны, API и данные?

---

# 1. СКВОЗНОЙ СЦЕНАРИЙ

Проверить следующий концептуальный сценарий:

```text
CLIENT CONTACT
      ↓
CUSTOMER
      ↓
CONVERSATION
      ↓
CUSTOMER REQUEST
      ↓
QUALIFICATION
      ↓
VEHICLE
      ↓
APPOINTMENT
      ↓
IN_PROGRESS
      ↓
COMPLETED
      ↓
SERVICE RECORD / SERVICE HISTORY
```

ВАЖНО:

Это только audit map.

Не считать, что именно такая последовательность уже реализована.

Для каждого перехода установить:

* существует ли он;
* автоматически ли происходит;
* выполняется ли вручную;
* какой UI используется;
* какой API используется;
* какие relation fields связывают сущности;
* где пользователь должен менять экран;
* где workflow прерывается.

---

# 2. TEST REAL USER JOURNEY

Не ограничиваться чтением компонентов.

Попытайся пройти сценарий через реальное приложение.

Используй существующие:

* frontend;
* backend;
* database;
* API;
* тестовые данные, если они уже есть.

Если возможно, провести реальный manual/browser flow.

Минимальный сценарий:

### STEP A

Создать или использовать существующего клиента.

### STEP B

Создать/получить Conversation.

### STEP C

Создать Customer Request.

### STEP D

Связать Request с:

* Customer;
* Vehicle;
* Service;
* Conversation,

если это поддерживается существующей моделью.

### STEP E

Изменить Request lifecycle.

Например:

```text
NEW
→ IN_PROGRESS
→ WAITING_CUSTOMER / QUALIFIED
```

Использовать только реальные разрешённые transitions.

### STEP F

Создать Appointment.

Проверить:

* Customer;
* Vehicle;
* Service;
* Request relationship.

### STEP G

Изменить Appointment:

```text
SCHEDULED
→ CONFIRMED
→ IN_PROGRESS
→ COMPLETED
```

если backend допускает такую последовательность.

### STEP H

Проверить ServiceRecord / Service History.

Определить:

* появился ли ServiceRecord;
* должен ли он появляться;
* как его создать;
* сохраняется ли appointmentId;
* сохраняются ли vehicle/customer/service данные.

---

# 3. НЕ ИСПОЛЬЗОВАТЬ FAKE SUCCESS

Критически важно.

Если какой-то шаг невозможно выполнить:

НЕ создавать workaround, который только визуально делает вид, что всё работает.

Например:

не делать:

```text
click COMPLETED
→ frontend показывает "Service completed"
```

если backend не поддерживает это состояние.

Не создавать fake ServiceRecord.

Не создавать fake Appointment.

Не создавать fake Conversation.

Не создавать fake Request.

---

# 4. ENTITY CONTINUITY

Для одного клиента проверить сохранение identity на всём пути.

Например:

```text
Customer ID
      ↓
Request.customerId
      ↓
Appointment.customerId
      ↓
ServiceRecord.customerId
```

Должен использоваться один реальный Customer.

То же самое проверить для Vehicle:

```text
Vehicle ID
      ↓
Request.vehicleId
      ↓
Appointment.vehicleId
      ↓
ServiceRecord.vehicleId
```

И Service:

```text
Service ID
      ↓
Request.serviceId
      ↓
Appointment.serviceId
      ↓
ServiceRecord.serviceId
```

Если какая-либо связь отсутствует — зафиксировать.

---

# 5. REQUEST CONTINUITY

Проверить:

```text
Conversation
      ↕
CustomerRequest
      ↕
Appointment
```

Определить, где Request ID теряется.

Особенно важно:

### Request → Appointment

Установить:

* есть ли relation;
* создаётся ли Appointment из Request;
* можно ли увидеть Appointment из Request Detail;
* можно ли открыть Appointment из Request.

### Appointment → Request

Проверить обратную навигацию.

---

# 6. CONVERSATION CONTINUITY

Проверить:

```text
Conversation
→ Request
→ Client
→ Vehicle
→ Appointment
```

Но не создавать искусственные relation.

Если Conversation не имеет direct Appointment relation:

это должно быть явно отмечено.

Проверить, можно ли через существующий Request:

```text
Conversation
→ Request
→ Appointment
```

без fragile custom join.

---

# 7. OPERATIONS CONTINUITY

Рабочая очередь должна быть частью workflow.

Проверить:

### NEW Request

Появляется ли в `/operations`?

### IN_PROGRESS

Исчезает ли или перемещается корректно?

### WAITING_CUSTOMER

Попадает ли в соответствующий operational bucket?

### Escalation

Появляется ли корректно?

### Appointment

Если Appointment не относится к Operations — определить почему.

Не менять Operations без необходимости.

---

# 8. CROSS-NAVIGATION MATRIX

Построить реальную таблицу:

| Source       | Target          | Exists | Working |
| ------------ | --------------- | -----: | ------: |
| Conversation | Request         |        |         |
| Conversation | Client          |        |         |
| Conversation | Vehicle         |        |         |
| Conversation | Appointment     |        |         |
| Request      | Conversation    |        |         |
| Request      | Client          |        |         |
| Request      | Vehicle         |        |         |
| Request      | Appointment     |        |         |
| Client       | Conversation    |        |         |
| Client       | Request         |        |         |
| Client       | Vehicle         |        |         |
| Client       | Appointment     |        |         |
| Vehicle      | Client          |        |         |
| Vehicle      | Request         |        |         |
| Vehicle      | Conversation    |        |         |
| Vehicle      | Appointment     |        |         |
| Appointment  | Client          |        |         |
| Appointment  | Request         |        |         |
| Appointment  | Vehicle         |        |         |
| Appointment  | Conversation    |        |         |
| Appointment  | Service History |        |         |

Использовать:

* direct relations;
* существующие routes;
* существующие `?open=` mechanics.

Не создавать новые relations только ради таблицы.

---

# 9. CONTEXT LOSS AUDIT

Это один из главных пунктов.

Для каждого перехода спросить:

> Теряет ли администратор контекст?

Например:

```text
Request
→ Appointment
```

Остаётся ли понятно:

* какой клиент;
* какой автомобиль;
* какая услуга;
* какая заявка?

И наоборот:

```text
Appointment
→ Request
```

сохраняется ли тот же контекст?

Также:

```text
Conversation
→ Request
→ Appointment
```

не должен превращаться в ситуацию, где администратор вынужден заново искать клиента.

---

# 10. DEAD ENDS

Найти все operational dead ends.

Примеры:

```text
Conversation
→ Request
→ STOP
```

или:

```text
Request
→ Appointment
→ STOP
```

или:

```text
Appointment COMPLETED
→ STOP
```

Не все STOP являются ошибками.

Для каждого определить:

### Valid endpoint

Workflow действительно заканчивается здесь.

или

### Product gap

Здесь должен быть следующий business step, но его нет.

Не создавать следующий step автоматически.

---

# 11. FORM DATA LOSS

Проверить create/edit forms.

Например:

Создание Appointment должно сохранять выбранные:

* customer;
* vehicle;
* service;
* date;
* time;
* request,

если эти поля реально существуют.

После сохранения:

открыть Appointment Detail и проверить, что данные не потерялись.

То же для Request.

То же для ServiceRecord.

---

# 12. STATUS CONSISTENCY

Проверить, что frontend не показывает status, который backend не поддерживает.

Сопоставить:

```text
Frontend labels
vs
Backend enums
vs
API validation
```

Особенно:

### CustomerRequest

### Appointment

### Escalation

Не создавать frontend-only statuses.

---

# 13. COMPLETED STATE

Особенно подробно проверить:

```text
Appointment → COMPLETED
```

Ответить:

1. Что меняется в DB?
2. Что меняется в UI?
3. Создаётся ли ServiceRecord?
4. Если нет — как появляется ServiceRecord?
5. Может ли администратор вручную создать ServiceRecord?
6. Есть ли связь `ServiceRecord.appointmentId`?
7. Видно ли её в UI?
8. Можно ли вернуться из Service History к Appointment?

---

# 14. SERVICE HISTORY CONTINUITY

Проверить реальный путь:

```text
Vehicle
→ Service History
```

и:

```text
Appointment
→ Service History
```

Определить, одинаковый ли ServiceRecord виден из обоих контекстов.

Если нет:

почему?

Не исправлять автоматически.

---

# 15. API FLOW

Составить фактическую последовательность API calls.

Например:

```text
POST /api/customers
POST /api/conversations
POST /api/customer-requests
PATCH /api/customer-requests/:id
POST /api/appointments
PATCH /api/appointments/:id
POST /api/service-history
```

Но использовать только реальные endpoints.

Указать:

* какие calls происходят;
* какие данные передаются;
* где есть dependencies;
* где есть ручной переход пользователя.

---

# 16. N+1 / PERFORMANCE

Проверить E2E flow на ненужные повторные запросы.

Особенно:

* Client Detail;
* Request Detail;
* Conversation Detail;
* Appointment Detail;
* Vehicle Detail;
* Operations.

Не исправлять уже принятые trade-offs без необходимости.

Но если Prompt 30 обнаружит новый серьёзный N+1:

зафиксировать его.

---

# 17. AUTH / TENANT ISOLATION

Проверить, что E2E flow использует существующую tenant isolation.

Ни один ID нельзя считать достаточным основанием для доступа.

Проверить, что:

* Customer;
* Request;
* Vehicle;
* Conversation;
* Appointment;
* ServiceRecord

проверяются в рамках текущего tenant.

Не переписывать authentication.

---

# 18. ERROR RECOVERY

Проверить, что происходит, если один шаг не проходит.

Например:

Appointment creation fails.

Должно быть понятно:

* что не сохранилось;
* что уже сохранилось;
* можно ли повторить;
* не создан ли duplicate.

Не создавать distributed transaction, если её нет.

---

# 19. DUPLICATION AUDIT

Проверить, не создаёт ли пользователь случайно:

* duplicate Customer;
* duplicate Request;
* duplicate Appointment;
* duplicate ServiceRecord.

Особенно после:

* retry;
* browser refresh;
* повторного submit.

Если защиты нет:

зафиксировать.

Не добавлять сложный idempotency system в Prompt 30.

---

# 20. PRODUCT FLOW SCORE

После аудита оцени каждое звено:

| Flow                        | Score |
| --------------------------- | ----: |
| Contact → Conversation      |    /5 |
| Conversation → Request      |    /5 |
| Request → Qualification     |    /5 |
| Request → Vehicle           |    /5 |
| Request → Appointment       |    /5 |
| Appointment → IN_PROGRESS   |    /5 |
| Appointment → COMPLETED     |    /5 |
| Completed → Service History |    /5 |
| Cross-navigation            |    /5 |
| Context preservation        |    /5 |

Используй:

* 5 = complete;
* 4 = works with minor friction;
* 3 = works but significant manual step;
* 2 = partially works;
* 1 = mostly broken;
* 0 = does not exist.

Не завышать оценку.

---

# 21. PRODUCT DECISION

После аудита выбрать:

## OPTION A

E2E workflow уже достаточно цельный.

Тогда:

**не добавлять новый business functionality.**

Можно только перечислить minor UX/technical debt.

---

## OPTION B

Есть конкретные разрывы, которые можно закрыть существующими API без новой бизнес-сущности.

Тогда реализовать только эти небольшие fixes.

---

## OPTION C

Есть фундаментальный product gap.

Например:

```text
Appointment COMPLETED
→ неизвестно, как фиксировать фактически выполненную работу
```

Тогда:

**не создавать WorkOrder.**

Документировать gap для отдельного product decision.

---

# 22. IMPLEMENTATION RULE

Prompt 30 — преимущественно audit.

Допустимы только небольшие исправления, если они:

* используют существующие API;
* не меняют Prisma;
* не создают новую business entity;
* не меняют AI;
* не меняют authentication;
* не ломают существующие screens.

Если проблема требует новой бизнес-модели:

**не реализовывать.**

---

# 23. NO NEW PRODUCT SYSTEMS

В Prompt 30 запрещено создавать:

* WorkOrder;
* Job;
* Invoice;
* Payment;
* Inventory;
* Parts;
* Technician assignment;
* Scheduling engine;
* notification engine;
* AI automation;
* CRM integration;
* billing;
* subscription changes.

---

# 24. VALIDATION

После возможных изменений:

```bash
npx tsc --noEmit
npm run build
npm test
```

Проверить:

* TypeScript;
* Build;
* Tests;
* all existing routes;
* E2E flow;
* no regression.

Если в проекте есть существующие Playwright/Cypress tests:

найти и использовать их.

Если E2E infrastructure отсутствует:

не создавать огромный test framework.

---

# 25. GIT

Если изменения сделаны:

создать commit:

```text
feat: audit end-to-end operational flow
```

Если это чистый audit без code changes:

не создавать пустой commit.

Push без force.

---

# 26. FINAL REPORT

Создать:

`docs/final-reports/final-report-30.md`

Структура:

## 1. Executive Summary

Краткий итог E2E аудита.

## 2. Tested User Journey

Пошагово:

Customer → Conversation → Request → Vehicle → Appointment → Completed → Service History.

Для каждого шага:

* PASS;
* PARTIAL;
* BLOCKED;
* NOT APPLICABLE.

## 3. Entity Continuity

Проверить:

Customer ID continuity.

Vehicle ID continuity.

Service ID continuity.

Request ID continuity.

Appointment ID continuity.

ServiceRecord ID continuity.

## 4. Request Lifecycle

Реальный путь.

## 5. Appointment Lifecycle

Реальный путь.

## 6. Completed Behavior

Что реально происходит при COMPLETED.

## 7. Service History

Как реально появляется/изменяется ServiceRecord.

## 8. Cross-navigation Matrix

Полная таблица.

## 9. Context Loss

Все места потери контекста.

## 10. Dead Ends

Все dead ends.

Разделить:

* valid endpoints;
* product gaps.

## 11. Form/Data Integrity

Есть ли data loss.

## 12. Status Consistency

Frontend vs backend.

## 13. API Flow

Реальная последовательность API.

## 14. N+1 / Performance

Результаты.

## 15. Tenant Isolation

Результаты.

## 16. Error Recovery

Результаты.

## 17. Duplication Risks

Результаты.

## 18. Product Flow Score

Таблица /5.

## 19. Product Decision

A / B / C.

## 20. Implementation

Что реально изменено.

Если ничего:

`Audit only — no code changes.`

## 21. Files Changed

Полный список.

## 22. Backend / Prisma

Явно:

* backend changes;
* Prisma changes;
* migrations.

## 23. Validation

* TypeScript;
* Build;
* Tests;
* E2E/manual flow.

## 24. Git

Commit + push status.

## 25. Product Gaps

Приоритет:

### P0 — блокирует основной workflow

### P1 — существенно ухудшает workflow

### P2 — minor UX/technical debt

## 26. Screenshot

Указать:

`Screenshot validation performed`

или:

`No screenshot validation performed`

---

# STOP CONDITION

После Final Report:

**СТОП.**

Не переходить к Prompt 31.

Не создавать WorkOrder.

Не создавать Invoice.

Не создавать Payment.

Не создавать Inventory.

Не создавать Technician workflow.

Не создавать новые Prisma models.

Не начинать новый feature просто потому, что обнаружен product gap.

Сначала дождаться моего review.

---

# ГЛАВНЫЙ РЕЗУЛЬТАТ

После Prompt 30 мы должны знать не просто:

> «У нас есть Dashboard, Clients, Requests, Vehicles, Conversations и Appointments».

А:

> **Может ли реальный администратор провести одну заявку через систему от обращения клиента до фактического завершения обслуживания, не теряя клиента, автомобиль, услугу и контекст заявки по дороге?**

И если ответ «нет» — мы должны точно знать **где и почему**, прежде чем строить следующий слой продукта.
