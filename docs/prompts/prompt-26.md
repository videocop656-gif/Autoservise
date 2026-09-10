# Prompt 26 — Vehicle Context & Service History Audit v1

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# PROMPT 26 — Vehicle Context & Service History Audit v1

## Контекст проекта

Продолжаем разработку production-oriented SaaS для администратора автосервиса.

Уже реализованы:

* Dashboard
* `/operations` — Рабочая очередь
* `/requests` — Customer Requests + Request Detail
* `/conversations` — Conversations + Conversation Detail
* `/clients` — Clients + Client Detail

Последний реализованный слой:

**Operational Work Queue v1**

Он связывает Requests, Conversations, Clients и Escalations.

---

# Главная цель Prompt 26

Теперь нужно определить, какое место в системе должен занимать **автомобиль (Vehicle)**.

Важно:

**НЕ НАЧИНАЙ СРАЗУ СОЗДАВАТЬ `/vehicles`.**

Сначала проведи технический и продуктовый аудит существующей Vehicle-модели и связанных данных.

Нам нужно понять:

1. Какие реальные данные уже хранятся об автомобиле?
2. Какие сущности реально связаны с Vehicle?
3. Где сейчас автомобиль появляется в UI?
4. Есть ли уже история обслуживания?
5. Можно ли построить полноценный Vehicle Detail только на существующих API?
6. Нужен ли отдельный canonical `/vehicles` route?
7. Или Vehicle должен оставаться контекстом внутри Client / Request / Service History?

Главный принцип:

> Не создавать экран ради сущности. Создавать экран только если он решает реальную operational задачу.

---

# STEP 1 — ОБЯЗАТЕЛЬНЫЙ АУДИТ PRISMA

Изучи существующую Prisma schema.

Найди модель:

`Vehicle`

и все её relations.

Зафиксируй реальные поля.

Особенно проверь наличие:

* id
* customerId
* make
* model
* year
* VIN
* license plate
* mileage
* createdAt
* updatedAt
* status
* notes
* любые другие реальные поля

Не предполагай, что эти поля существуют.

---

# STEP 2 — ПРОВЕРЬ ВСЕ VEHICLE RELATIONS

Найди, какие сущности реально связаны с Vehicle.

Особенно:

* Customer
* CustomerRequest
* Conversation
* ServiceHistory
* другие реальные модели

Для каждой relation ответь:

```text
Vehicle → Customer
Vehicle → CustomerRequest
Vehicle → ServiceHistory
...
```

И укажи cardinality:

* one-to-one
* one-to-many
* many-to-one
* many-to-many

если это следует из schema.

---

# STEP 3 — АУДИТ EXISTING API

Найди все существующие endpoints, связанные с Vehicle.

Например:

```text
GET /api/vehicles
POST /api/vehicles
PATCH /api/vehicles/:id
DELETE /api/vehicles/:id
```

Но используй только реально существующие endpoints.

Проверь:

* pagination;
* search;
* filters;
* include relations;
* sorting;
* mutation capabilities;
* response DTO;
* validation.

Отдельно проверь существующий:

`/api/service-history`

и выясни:

* можно ли фильтровать по vehicle;
* какие поля возвращаются;
* связана ли запись с customer;
* связана ли запись с request;
* есть ли date/mileage/service information;
* поддерживает ли endpoint pagination.

---

# STEP 4 — АУДИТ СУЩЕСТВУЮЩЕГО FRONTEND

Найди все места, где Vehicle уже отображается.

Минимум проверь:

### `/clients`

Как сейчас автомобиль показывается в Client Detail?

### `/requests`

Как сейчас автомобиль показывается в Request Detail?

### `/conversations`

Есть ли vehicle context в Conversation Detail?

### `/operations`

Есть ли vehicle context в Work Queue?

### Service History

Где сейчас отображается история обслуживания?

---

# STEP 5 — СОЗДАЙ DATA MAP

Перед написанием UI составь внутреннюю карту:

```text
Customer
   │
   ├── Vehicle
   │      ├── Customer Requests
   │      ├── Service History
   │      └── Conversations
   │
   └── other existing relations
```

Но используй только реальные relations.

Если какая-либо стрелка отсутствует в Prisma/API — не создавай её.

---

# STEP 6 — ОПРЕДЕЛИ, НУЖЕН ЛИ `/vehicles`

После аудита прими решение.

## Вариант A — отдельный Vehicle Detail оправдан

Если существующие данные позволяют получить meaningful operational context:

* vehicle identity;
* owner;
* requests;
* service history;
* conversations;
* другие реальные связанные данные;

тогда можно создать:

`/vehicles`

с:

### Vehicle List

Поиск / pagination только если backend реально это поддерживает или это можно корректно сделать существующими API.

Минимальные реальные поля:

* vehicle;
* registration / license plate, если существует;
* owner;
* relevant status;
* updatedAt, если существует.

### Vehicle Detail

Header:

* make/model;
* registration;
* VIN — только если реально есть и уместен;
* owner.

Затем:

**Requests**

Все связанные Customer Requests.

**Service History**

Все реальные записи service history.

**Conversations**

Связанные conversations, если связь реально доступна.

**Customer**

Ссылка на существующий Client Detail.

---

# Вариант B — отдельный Vehicle route НЕ оправдан

Если Vehicle API/relations недостаточны для самостоятельного operational screen:

**НЕ СОЗДАВАЙ `/vehicles`.**

Вместо этого:

1. улучшить Vehicle context внутри Client Detail;
2. улучшить Vehicle context внутри Request Detail;
3. при необходимости улучшить Conversation Detail;
4. использовать существующий Service History там, где это имеет смысл.

Final Report должен прямо объяснить:

> Separate Vehicle Detail was not justified by the current data model/API.

Это абсолютно допустимый результат Prompt 26.

---

# STEP 7 — ЕСЛИ СОЗДАЁТСЯ `/vehicles`

Только если аудит подтвердил необходимость.

Создай:

`/vehicles`

как canonical Vehicle route.

Добавь в navigation только если это логично соответствует текущей IA.

Не создавай одновременно:

* `/vehicles`
* `/cars`
* `/garage`
* `/fleet`

Нужен один canonical route.

---

# STEP 8 — VEHICLE DETAIL

Если Vehicle Detail создаётся, он должен быть operational, а не просто карточкой характеристик.

Главная идея:

> "Что мы знаем об этой машине и что с ней происходило?"

Структура:

### Vehicle header

Реальные данные автомобиля.

### Owner

Ссылка:

**Открыть клиента**

→ существующий Client Detail.

### Current requests

Связанные Customer Requests.

Каждая запись:

* status;
* service;
* createdAt;
* relevant information.

CTA:

**Открыть заявку**

→ существующий Request Detail.

### Service history

Хронологическая история.

Использовать существующий Service History API.

Не создавать новую историю обслуживания.

### Conversations

Если связь реально существует:

* conversation;
* last relevant timestamp;
* status, если существует.

CTA:

**Открыть диалог**

→ существующий Conversation Detail.

---

# STEP 9 — НЕ ПРИДУМЫВАЙ VEHICLE HEALTH

Не создавать:

* health score;
* diagnostic score;
* maintenance score;
* next service prediction;
* AI vehicle health;
* fuel analytics;
* OBD;
* predictive maintenance;
* mileage prediction.

Если таких данных нет в текущей системе — их нет.

Это не задача Prompt 26.

---

# STEP 10 — SERVICE HISTORY

Отдельно исследуй текущую модель ServiceHistory.

Нужно определить, является ли она:

1. полноценной историей обслуживания;
2. простым журналом событий;
3. связанной с CustomerRequest;
4. связанной только с Customer;
5. связанной с Vehicle.

Если ServiceHistory нельзя корректно связать с Vehicle без backend changes:

**не создавай искусственную связь на frontend.**

Зафиксируй limitation.

---

# STEP 11 — CREATE / EDIT VEHICLE

Если существующие Vehicle mutation endpoints уже есть:

можно использовать существующий create/edit workflow.

Но:

* не добавляй новые поля;
* не меняй validation;
* не создавай новый backend endpoint;
* не создавай новую Prisma relation.

Если mutation API отсутствует:

не создавай полноценный frontend form, который не может сохранить данные.

---

# STEP 12 — CROSS-NAVIGATION

Если Vehicle Detail реализуется:

обязательно проверить:

### Client → Vehicle

Можно ли открыть конкретный Vehicle?

### Request → Vehicle

Можно ли перейти к Vehicle Detail?

### Conversation → Vehicle

Только если conversation реально связан с vehicle.

### Vehicle → Client

Да.

### Vehicle → Request

Да, если relation существует.

### Vehicle → Conversation

Да, если relation существует.

Не создавай navigation, для которой backend не может гарантировать связь.

---

# STEP 13 — N+1

Критическое требование.

Запрещено:

```text
load vehicles
→ for each vehicle load customer
→ for each vehicle load requests
→ for each vehicle load service history
→ for each vehicle load conversations
```

Если создаётся Vehicle List:

не загружай связанные данные отдельно для каждой строки.

Используй:

* existing include/reference APIs;
* bulk endpoints;
* один detail-level batch;
* существующие paginated endpoints.

Для Vehicle Detail допустимы несколько параллельных запросов, если это действительно необходимо.

Используй `Promise.allSettled` или существующий проектный pattern.

---

# STEP 14 — PERFORMANCE

Не загружай огромную историю целиком, если endpoint поддерживает pagination.

Особенно:

* service history;
* requests;
* conversations.

Используй существующую pagination.

Не вводи искусственный `pageSize=1000`.

---

# STEP 15 — RESPONSIVE

Если создаётся Vehicle Detail:

### Desktop

* vehicle identity;
* owner;
* requests;
* service history;
* conversations.

### Mobile

* одна колонка;
* без горизонтального scroll;
* CTA доступны;
* timeline/history остаётся читаемой.

Используй существующий design system.

---

# STEP 16 — UI

Не делай Vehicle Detail похожим на техническую панель телематики.

Это административная CRM/operations система.

Приоритет:

1. идентификация автомобиля;
2. владелец;
3. текущие заявки;
4. история обслуживания;
5. связанные коммуникации.

Не добавляй графики без реальной data requirement.

---

# STEP 17 — НЕ ДЕЛАТЬ

В Prompt 26 запрещено:

* новая Prisma model;
* новая Vehicle relation без необходимости;
* OBD;
* telematics;
* diagnostics;
* predictive maintenance;
* AI vehicle health;
* parts inventory;
* invoices;
* payments;
* technician workflow;
* mechanic app;
* scheduling;
* appointments;
* fake service records;
* fake vehicle data;
* новые бизнес-статусы.

Также не переписывай Client/Request/Conversation screens полностью.

---

# STEP 18 — BACKEND CHANGES

Предпочтительный результат:

**No backend changes.**

Но если аудит объективно показывает, что одна небольшая backend/API корректировка необходима для уже существующей функциональности Vehicle Detail:

не делай её молча.

В Final Report подробно укажи:

* почему frontend-only недостаточно;
* какой endpoint недостаточен;
* какая минимальная backend modification нужна;
* почему это не новая бизнес-сущность.

Если изменение backend затрагивает Prisma schema или migration:

остановись перед применением migration и зафиксируй это в отчёте, если такая migration действительно необходима.

---

# STEP 19 — VALIDATION

После реализации:

```bash
npx tsc --noEmit
```

затем:

```bash
npm run build
```

и существующий test suite.

Проверь:

1. Vehicle data реальные.
2. Нет fake records.
3. Все Vehicle relations соответствуют Prisma/API.
4. Client navigation работает.
5. Request navigation работает.
6. Conversation navigation работает, если relation существует.
7. Service History работает.
8. Нет N+1.
9. Existing `/clients` работает.
10. Existing `/requests` работает.
11. Existing `/conversations` работает.
12. `/operations` работает.
13. TypeScript PASS.
14. Build PASS.
15. Tests PASS.

---

# STEP 20 — GIT

Создай отдельный commit.

Если отдельный Vehicle Detail действительно создан:

```text
feat: add vehicle context v1
```

Если задача завершилась без отдельного Vehicle route и были только context improvements:

используй commit message, соответствующий фактическому результату.

После commit:

```bash
git status
```

Рабочее дерево должно быть clean.

---

# FINAL REPORT

После выполнения остановись и подготовь:

## Final Report — Prompt 26: Vehicle Context v1

### 1. Audit Result

Что обнаружено в Prisma/API.

### 2. Vehicle Data Model

Реальные поля Vehicle.

### 3. Relations

Полная карта реальных relations.

### 4. Existing API

Все использованные Vehicle / Service History endpoints.

### 5. Product Decision

Чётко написать одно:

**A. Separate Vehicle Detail justified**

или

**B. Separate Vehicle Detail not justified**

И объяснить почему.

### 6. Implementation

Что реально сделано.

### 7. Files Changed

Полный список.

### 8. Backend

* backend changed: YES/NO
* Prisma changed: YES/NO
* migrations: YES/NO

### 9. N+1 Audit

Как именно загружаются данные.

### 10. Cross-navigation

Проверить:

* Client → Vehicle
* Request → Vehicle
* Conversation → Vehicle
* Vehicle → Client
* Vehicle → Request
* Vehicle → Conversation

### 11. Service History

Как она связана с Vehicle и как отображается.

### 12. Validation

Результаты:

* TypeScript
* Build
* Tests

С реальными цифрами.

### 13. Git

Commit hash + message.

### 14. Limitations

Только реальные ограничения.

### 15. Screenshot

Если screenshot validation не проводилась:

> No screenshot validation performed.

Не утверждай визуальную проверку, если её не было.

---

# STOP CONDITION

После Final Report остановись.

Не переходи к Prompt 27.

Не добавляй дополнительные automotive features "заодно".

Не создавай backend functionality только ради красивого UI.

Главный результат Prompt 26:

**мы должны понять и реализовать реальную роль Vehicle в существующей операционной модели, а не просто добавить ещё один CRUD.**
