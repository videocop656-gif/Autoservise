# Prompt 28 — Appointment Detail & Scheduling Audit v1

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# Prompt 28 — Appointment Detail & Scheduling Audit v1

## CONTEXT

Мы продолжаем разработку production-oriented SaaS для AI-администратора автосервиса.

Уже реализованы:

* Dashboard
* `/operations` — Рабочая очередь
* `/requests` — Customer Requests
* `/clients` — Clients
* Vehicle Context
* `/conversations` — Conversation Detail
* Service History
* Request Lifecycle v2

В Prompt 27 был проведён аудит CustomerRequest lifecycle.

Ключевой результат Prompt 27:

* downstream workflow после `CustomerRequest.status = CONVERTED` сейчас отсутствует;
* нет подтверждённого WorkOrder / Job / Service Order workflow;
* не нужно выдумывать такие сущности;
* `/appointments` уже существует, но сейчас не имеет полноценного per-item detail mechanism;
* это необходимо исследовать отдельно.

Git после Prompt 27:

`6ae965b` — `feat: improve request lifecycle v2`

Не переписывай существующую архитектуру и не создавай новый бизнес-слой без доказательства в текущем коде.

---

# 1. PRIMARY GOAL

Провести полный аудит существующей Appointment-модели и решить:

**Нужен ли Appointment Detail как отдельный операционный интерфейс и что именно он должен показывать/изменять на основании уже существующих данных и API.**

Главный принцип:

> Не создавать «идеальную систему автосервиса». Улучшить только тот workflow, который уже реально поддерживается backend.

---

# 2. AUDIT PRISMA / DATA MODEL

Сначала исследуй реальные Prisma schema/model definitions.

Найди и изучи:

* Appointment
* Customer
* Vehicle
* CustomerRequest
* Conversation
* ServiceHistory
* Service
* Technician / Employee / Staff — если реально существует
* любые связанные сущности

Отдельно установи:

* реальные поля Appointment;
* реальные enum values;
* обязательные и optional relations;
* customer relation;
* vehicle relation;
* request relation;
* service relation;
* date/time поля;
* status;
* notes/comments;
* createdAt / updatedAt;
* любые cancellation/rescheduling fields;
* любые реальные ссылки на ServiceHistory.

Не предполагай существование полей.

---

# 3. AUDIT EXISTING APPOINTMENT API

Найди все backend endpoints, связанные с Appointment.

Проверь:

* GET list;
* GET single item, если существует;
* POST/create;
* PATCH/update;
* DELETE, если существует;
* status transitions;
* cancellation;
* rescheduling;
* customer/request/vehicle relations.

Для каждого endpoint зафиксируй:

* HTTP method;
* route;
* input;
* response;
* validation;
* authorization;
* реальные ограничения.

Особенно важно установить:

**может ли существующий API открыть и изменить конкретный Appointment без создания нового endpoint?**

---

# 4. AUDIT CURRENT /APPOINTMENTS SCREEN

Изучи существующий frontend `/appointments`.

Определи:

* как загружается список;
* какие поля отображаются;
* есть ли search;
* есть ли filters;
* есть ли pagination;
* есть ли status filtering;
* есть ли date filtering;
* как создаётся Appointment;
* как редактируется Appointment;
* есть ли возможность открыть конкретную запись;
* есть ли empty/loading/error states;
* какие данные реально доступны без N+1.

Не переписывай экран целиком без необходимости.

---

# 5. DETERMINE APPOINTMENT LIFECYCLE

Построй реальную lifecycle-схему Appointment на основании кода.

Например, если существуют реальные статусы:

`X → Y → Z`

зафиксируй их именно такими.

Не создавай новые статусы.

Для каждого перехода укажи:

* кто/что его выполняет;
* какой API используется;
* есть ли backend validation;
* какие связанные сущности меняются.

Особенно проверить:

### Cancellation

Что реально происходит при отмене?

### Rescheduling

Можно ли реально изменить дату/время?

### Completion

Существует ли реальное понятие завершения Appointment?

### Service History

Создаётся ли ServiceHistory автоматически?

Если да — показать точную backend-логику.

Если нет — НЕ создавать такую связь самостоятельно.

---

# 6. CRITICAL QUESTION: WHAT DOES APPOINTMENT REPRESENT?

Нужно определить семантику существующей сущности.

Appointment — это:

* только слот записи;
* подтверждённая запись клиента;
* запись на конкретную услугу;
* часть более широкого service workflow;
* или другое реальное понятие?

Ответ должен быть основан на текущем Prisma/API/frontend коде.

Не вводи новую бизнес-семантику.

---

# 7. APPOINTMENT DETAIL DECISION

На основании аудита принять одно из решений.

### OPTION A — полноценный Detail оправдан

Если существующая модель и API содержат достаточно данных:

создать Appointment Detail.

Detail должен показывать только реально существующий контекст:

* дата/время;
* статус;
* customer;
* vehicle;
* service;
* customer request;
* conversation;
* notes — если реально существуют;
* другие существующие поля.

Разрешить только те действия, для которых существует реальный backend API:

* edit;
* status change;
* cancel;
* reschedule;
* etc.

### OPTION B — Detail нужен, но API ограничивает функциональность

Создать Detail как read-only или partially editable.

Чётко обозначить, какие действия невозможны из-за текущего backend.

### OPTION C — отдельный Detail сейчас не нужен

Если Appointment слишком прост и отдельный Detail создаст только UI complexity, оставить текущий list/create workflow и документировать product gap.

---

# 8. CROSS-NAVIGATION

Проверить существующие связи.

Нужны только реально поддерживаемые направления.

Проверить:

Appointment →

* Client
* Vehicle
* Request
* Conversation
* Service History

И обратные направления:

Client → Appointment
Vehicle → Appointment
Request → Appointment
Conversation → Appointment
Service History → Appointment

Не создавать двухшаговые derived joins только ради красивой навигации.

Если relation отсутствует — документировать.

---

# 9. REQUEST → APPOINTMENT

Отдельно исследовать:

Есть ли сейчас реальная связь:

`CustomerRequest → Appointment`

Если есть:

* показать её;
* использовать существующий relation/API;
* обеспечить навигацию.

Если связи нет:

**НЕ создавать её автоматически только потому, что бизнес-логически она кажется правильной.**

Также не трактовать `CONVERTED` как автоматическое создание Appointment.

Это особенно важно после Prompt 27.

---

# 10. APPOINTMENT → SERVICE HISTORY

Проверить существующую связь.

Если ServiceHistory существует отдельно и Appointment не связан с ним напрямую:

не создавать автоматическое связывание.

Если связь реально существует:

использовать её в Detail.

ServiceHistory не превращать в WorkOrder.

---

# 11. NO PROCESS THEATER

Запрещено добавлять без существующего backend/model support:

* Work Order;
* Job Card;
* Technician assignment;
* mechanic assignment;
* parts;
* inventory;
* invoice;
* payment;
* OBD;
* repair stages;
* SLA;
* artificial progress;
* fake deadlines;
* fake availability;
* fake calendar capacity;
* automatic ServiceHistory creation;
* automatic Appointment creation after CONVERTED.

Также нельзя создавать frontend-only бизнес-логику, которая делает вид, что такой workflow существует.

---

# 12. N+1 AUDIT

Для `/appointments` list:

* не делать request per row;
* использовать bulk/reference fetches;
* если нужны Customer/Vehicle/Request/Service данные — загружать их bulk способом.

Для Appointment Detail:

* независимые запросы выполнять параллельно через `Promise.allSettled` или эквивалент;
* не делать последовательную цепочку там, где зависимости нет.

Особенно проверить, не появляется ли N+1 при отображении:

* customer;
* vehicle;
* service;
* request;
* conversation.

---

# 13. FRONTEND IMPLEMENTATION

Если принят OPTION A или B:

создать/обновить:

`src/components/appointments/shared.ts`

и:

`src/components/appointments/AppointmentDetailPanel.tsx`

или использовать существующий аналог, если он уже есть.

Detail должен соответствовать существующей визуальной системе приложения.

Не создавать новую design system.

Сохранить:

* light theme;
* dark theme;
* существующие spacing;
* typography;
* buttons;
* cards;
* status badges;
* responsive behavior.

Desktop:

list + detail/in-panel architecture, если это соответствует существующей структуре приложения.

Mobile:

single-column detail.

---

# 14. NAVIGATION

Если Appointment Detail создан:

добавить корректные `?open=` / route mechanics по существующему паттерну приложения.

Проверить:

* прямое открытие;
* back;
* refresh;
* cross-navigation;
* отсутствие broken links.

Не создавать новый routing pattern, если уже существует рабочий.

---

# 15. BACKEND / PRISMA

Предпочтительно:

**NO backend changes.**

Если существующий API уже предоставляет всё необходимое — использовать его.

Если для Detail критически необходим backend endpoint:

1. сначала доказать, что существующий API действительно недостаточен;
2. создать минимальное изменение;
3. не менять Prisma schema без реальной необходимости;
4. не создавать новые бизнес-сущности.

Любое backend изменение обязательно зафиксировать в Final Report.

---

# 16. VALIDATION

Обязательно выполнить:

```bash
npx tsc --noEmit
npm run build
npm test
```

или реальные project-specific equivalent commands.

Проверить:

* TypeScript PASS;
* Build PASS;
* Tests PASS;
* no regression;
* existing routes still work.

---

# 17. GIT

Если код изменён:

создать отдельный commit:

`feat: appointment detail v1`

Push.

Не использовать force push.

Если код не менялся:

зафиксировать это в отчёте.

---

# 18. FINAL REPORT

После выполнения остановиться и прислать только Final Report.

Структура:

## 1. Audit Summary

## 2. Appointment Data Model

## 3. Appointment Lifecycle

## 4. Existing Appointment API

## 5. Current /appointments Screen

## 6. Appointment Semantics

## 7. Request → Appointment Relationship

## 8. Service History Relationship

## 9. Product Decision

Указать:

`A / B / C`

и почему.

## 10. Implementation

Что конкретно сделано.

## 11. Files Changed

Полный список.

## 12. API Used

Только реальные endpoints.

## 13. Backend / Prisma

Что изменилось или почему ничего не менялось.

## 14. N+1 Audit

Конкретно:

* list;
* detail;
* reference data.

## 15. Cross-navigation

Таблица:

`Source → Target → Status`

## 16. Validation

* TypeScript
* Build
* Tests

## 17. Git

Commit hash + push status.

## 18. Limitations / Product Gaps

Только реальные ограничения.

## 19. Screenshot

Указать:

* screenshot validation performed;
* или `No screenshot validation performed`.

---

# IMPORTANT STOP CONDITION

После Final Report:

**НЕ переходить к Prompt 29.**

Сначала дождаться моего review.

Главная цель этого шага — не «добавить ещё один экран», а определить реальную роль Appointment в уже существующей операционной системе приложения.
