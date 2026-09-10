# Prompt 24 — Customer Requests / Заявки v1

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# PROMPT 24 — CUSTOMER REQUESTS / ЗАЯВКИ V1

## Роль

Ты работаешь как senior full-stack engineer в существующем production-oriented проекте:

**AI Администратор / Autoservice**

На предыдущих этапах уже реализованы:

* authentication;
* customers;
* vehicles;
* services;
* customer requests;
* service history;
* conversations;
* conversation detail;
* escalations;
* Telegram integration;
* AppShell;
* Dashboard;
* Conversations Inbox;
* Clients;
* Client Detail.

Последние завершённые этапы:

* Prompt 22 — Conversation Detail v1
* Prompt 23 — Clients v1

Сейчас необходимо реализовать полноценный operational раздел:

# Заявки / Customer Requests v1

---

# 1. ГЛАВНАЯ ЦЕЛЬ

Создать рабочий frontend-раздел **«Заявки»**, который позволяет администратору автосервиса:

* видеть список заявок;
* искать заявки;
* фильтровать их по существующим реальным статусам;
* открывать заявку;
* видеть клиента;
* видеть автомобиль;
* видеть услугу;
* видеть связанные данные;
* видеть связанную conversation, если она существует;
* менять статус только через существующий backend/API;
* использовать уже существующие operational flows.

Это должен быть **реальный operational UI**, а не demo CRUD.

---

# 2. КРИТИЧЕСКИ ВАЖНО — СНАЧАЛА АУДИТ

Перед написанием UI НЕ начинай сразу создавать компоненты.

Сначала изучи существующий проект.

Найди:

* Prisma model `CustomerRequest`;
* существующий Customer Request API;
* существующую страницу/компоненты customer requests;
* типы TypeScript;
* enum статусов;
* API validation;
* POST endpoint;
* PATCH endpoint;
* DELETE endpoint, если существует;
* связи CustomerRequest → Customer;
* связи CustomerRequest → Vehicle;
* связи CustomerRequest → Service;
* связи CustomerRequest → Conversation;
* существующие UI patterns;
* существующую pagination;
* существующий search;
* существующие badges/status components;
* существующие detail panels.

---

# 3. НЕ ПРИДУМЫВАТЬ CUSTOMER REQUEST MODEL

Это одно из главных требований Prompt 24.

Используй только реальные:

* поля;
* связи;
* enum;
* статусы;
* timestamps;
* API operations.

Нельзя самостоятельно придумывать:

```
NEW
IN_PROGRESS
WAITING
CONFIRMED
COMPLETED
CANCELLED
```

если таких значений реально нет.

Сначала прочитай Prisma/API.

Если реальный enum называется иначе — использовать именно его.

Если статусы отсутствуют — не создавать искусственную status system.

---

# 4. НЕ МЕНЯТЬ BACKEND БЕЗ НЕОБХОДИМОСТИ

Prompt 24 в первую очередь frontend.

Не изменять:

* Prisma schema;
* migrations;
* existing API contracts;
* authentication;
* Telegram;
* AI;
* Conversation logic;
* Escalation logic.

Если существующего API недостаточно для какого-либо UI:

> НЕ СОЗДАВАЙ новый endpoint автоматически.

Сначала зафиксируй ограничение.

Backend modification допустима только если без неё объективно невозможно реализовать заявленную функциональность и существующая архитектура явно предполагает такую операцию.

Если возникает такая ситуация:

1. остановись;
2. покажи, какой именно API capability отсутствует;
3. объясни минимальное необходимое изменение;
4. не выполняй миграцию или изменение Prisma автоматически.

---

# 5. CANONICAL ROUTE

Использовать:

```
/requests
```

Если такой route уже существует:

* улучшить существующую реализацию;
* не создавать вторую страницу.

Если customer requests сейчас находятся в другом разделе:

* сохранить существующий legacy route;
* при необходимости добавить redirect;
* `/requests` должен стать canonical operational route.

---

# 6. ОСНОВНАЯ СТРУКТУРА

Предпочтительный desktop layout:

```text
┌──────────────────────────────────────────────────────────────┐
│ Заявки                                      [Search]         │
│ Все заявки   [Status filter]                                │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ Заявка       Клиент          Автомобиль    Статус   Дата    │
│ ТО           Иван Петров     Toyota Camry  ...      ...     │
│ Диагностика Анна Смирнова    BMW X5        ...      ...     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

Это только структурная схема.

Реальные поля определить после аудита.

---

# 7. LIST DATA

Использовать существующий Customer Request endpoint.

Например, если существует:

```
GET /api/customer-requests
```

использовать именно его.

Не менять API.

Не создавать duplicate fetch layer.

---

# 8. REQUEST LIST

Список должен отображать только реальные данные.

Предпочтительная информация:

### Request

Название/summary/title — только если реально существует.

### Customer

Имя клиента.

### Vehicle

Марка/модель/номер — только если реально доступны.

### Service

Название услуги — если существует связь.

### Status

Только реальный status.

### Date

Использовать реальный createdAt / updatedAt / scheduledAt — в зависимости от модели.

Не переименовывать смысл поля.

Например:

если это `createdAt`, не показывать его как "Дата обслуживания".

---

# 9. SEARCH

Добавить поиск.

Сначала выяснить, поддерживает ли существующий API:

* `search`;
* `q`;
* search по customer;
* search по request title;
* search по vehicle.

Если server-side search существует:

использовать его.

Если нет:

не добавлять новый backend endpoint только ради поиска.

Допустимо фильтровать загруженный набор, если его размер и текущая архитектура это позволяют.

Не загружать огромные datasets только ради клиентского поиска.

---

# 10. DEBOUNCE

Если используется server-side search:

примерно:

```
300ms
```

debounce.

Использовать существующий project pattern, если он уже есть.

Не добавлять новую библиотеку.

---

# 11. PAGINATION

Использовать существующую pagination system.

Если API поддерживает:

```
page
pageSize
```

использовать их.

Не делать:

```
pageSize=1000
```

для обхода pagination.

Не создавать fake pagination на frontend, если backend уже предоставляет pagination.

---

# 12. STATUS FILTER

После аудита получить реальный набор статусов.

Если статусный enum существует:

создать filter:

```
Все
[status 1]
[status 2]
[status 3]
...
```

Использовать реальные значения.

Не создавать status labels, меняющие смысл backend status.

Можно сделать human-readable label, если mapping однозначный.

---

# 13. STATUS BADGES

Использовать существующий Badge component.

Статус должен быть понятен визуально.

Но не использовать цвет как единственный источник информации.

Не создавать новый global status system.

Если в проекте уже есть status badge mapping — использовать его.

---

# 14. REQUEST DETAIL

При клике на заявку открыть detail.

Предпочтительно:

```
/requests
    ↓
Request list
    ↓
Request detail
```

с использованием существующего inline/detail architecture проекта, если это уже паттерн.

Не создавать отдельную независимую реализацию без необходимости.

---

# 15. REQUEST DETAIL HEADER

Показать:

* back;
* request title/summary;
* current status;
* created date;
* available actions.

Только если эти поля реально существуют.

---

# 16. CUSTOMER CONTEXT

Detail должен показывать связанного клиента.

Например:

```text
Клиент

Иван Петров
+7 ...
email...
```

Использовать реальные данные.

Клик по клиенту должен вести в существующий:

```
/clients
```

и существующий Client Detail flow, если такой navigation pattern возможно реализовать без новой backend logic.

---

# 17. VEHICLE CONTEXT

Показать автомобиль, связанный с заявкой.

Использовать реальные данные:

* make;
* model;
* year;
* plate;
* VIN;

только если соответствующие поля существуют.

Не показывать placeholder:

```
Toyota Camry 2021
```

если это не реальные данные.

Если vehicle отсутствует:

```
Автомобиль не указан
```

или существующий language pattern.

---

# 18. SERVICE CONTEXT

Если request связан с Service:

показать:

```text
Услуга
Название услуги
```

Использовать реальное поле/relationship.

Если service отсутствует:

не придумывать его на основании текста заявки.

---

# 19. CONVERSATION CONTEXT

Если существует связь CustomerRequest → Conversation или conversation можно однозначно получить существующим API:

показать блок:

```text
Обращение

[Открыть разговор]
```

При клике использовать существующий:

```
/conversations?open=<conversationId>
```

и существующий Conversation Detail.

Не создавать второй messaging UI.

---

# 20. ESCALATION CONTEXT

Если существующий API позволяет определить escalation для request:

показать её.

Если такой связи нет:

не создавать её.

Не делать искусственный блок:

```
AI escalated
```

без реальной escalation data.

---

# 21. STATUS CHANGE

Если существующий API поддерживает изменение request status:

добавить действие:

```
Изменить статус
```

или существующий UI pattern.

Использовать существующий PATCH endpoint.

Например:

```
PATCH /api/customer-requests/:id
```

только если именно такой endpoint реально существует.

---

# 22. STATUS CHANGE SAFETY

Перед изменением статуса:

* использовать только допустимые backend values;
* не отправлять произвольные strings;
* обрабатывать API errors;
* после успешного изменения обновить detail/list;
* не делать optimistic update, если существующая архитектура не использует его безопасно.

---

# 23. DELETE

Если существующий API поддерживает delete:

не обязательно показывать delete в основном интерфейсе.

Для operational CRM предпочтительнее не делать опасное destructive action центральным.

Если delete уже является установленным pattern:

использовать существующий confirmation dialog.

Не создавать новую deletion logic.

---

# 24. CREATE REQUEST

Если существующая система уже имеет создание заявки:

не переписывать существующий flow.

Можно добавить:

```
Создать заявку
```

на `/requests`, если это соответствует существующему API/UI.

Использовать существующие:

* customer;
* vehicle;
* service;
* request fields.

Не создавать новые поля.

---

# 25. CREATE FORM

Если create form реализуется:

поля должны быть строго выведены из реального API contract.

Не добавлять:

* fake priority;
* fake source;
* fake estimated price;
* fake AI score;
* fake appointment date,

если их нет в backend.

---

# 26. DATA FETCHING — DETAIL

Для detail определить реальные необходимые endpoints.

Предпочтительно параллельные независимые запросы:

```
Promise.allSettled(...)
```

если это соответствует существующему project pattern.

Не делать:

```
load request
→ load customer
→ load vehicle
→ load service
→ load conversation
```

последовательно, если запросы независимы.

---

# 27. N+1 POLICY

Категорически запрещено:

```ts
requests.map(request => fetch(...))
```

для получения связанных данных каждого request.

Также запрещено:

```ts
customers.map(...)
vehicles.map(...)
services.map(...)
```

для каждой строки списка.

Сначала проверить:

* какие relations уже возвращает Customer Request API;
* какие reference lists уже существуют;
* какие bulk endpoints существуют.

---

# 28. COUNTS

Не добавлять counters, если их невозможно получить корректно.

Например:

```
124 заявок
37 open
18 completed
```

не нужно добавлять только ради красивого dashboard.

Если API не предоставляет достоверные агрегаты — не считать их через ограниченные reference lists.

---

# 29. EMPTY STATES

Обработать:

### Нет заявок

```text
Заявок пока нет
```

### Поиск ничего не нашёл

```text
По вашему запросу ничего не найдено
```

### Нет клиента

```text
Клиент не указан
```

### Нет автомобиля

```text
Автомобиль не указан
```

### Нет услуги

```text
Услуга не указана
```

### Нет conversation

Не показывать fake conversation.

Использовать существующий empty-state pattern.

---

# 30. LOADING STATES

List:

* skeleton.

Detail:

* skeleton.

Create/edit:

* loading state на submit.

Не показывать пустую страницу во время загрузки.

---

# 31. ERROR STATES

API errors должны быть видимыми.

Минимум:

* message;
* retry, если существующий pattern поддерживает retry.

Не использовать:

```ts
catch(() => {})
```

без обработки.

---

# 32. MOBILE

Mobile НЕ должен быть просто сжатой desktop table.

Использовать cards/list rows.

Например:

```text
┌─────────────────────────┐
│ Диагностика             │
│ Иван Петров             │
│ Toyota Camry            │
│                         │
│ [STATUS]        10.09   │
└─────────────────────────┘
```

Реальные данные — после аудита.

---

# 33. MOBILE DETAIL

Порядок:

```text
Header
↓
Status
↓
Request information
↓
Customer
↓
Vehicle
↓
Service
↓
Conversation
↓
Escalation
↓
Actions
```

Только существующие sections.

Не допускать horizontal overflow.

---

# 34. TABLET

На tablet:

* secondary columns можно скрывать;
* primary request information остаётся;
* detail остаётся читаемым.

Использовать существующие Tailwind breakpoints.

---

# 35. DESIGN SYSTEM

Использовать существующую design system проекта.

Утверждённое направление:

**Dark Graphite + Premium Gold**

```text
--background: 222 24% 7%;
--foreground: 0 0% 100%;

--card: 222 20% 12%;
--card-foreground: 0 0% 100%;

--primary: 45 90% 51%;
--primary-foreground: 222 24% 7%;

--muted: 222 16% 18%;
--muted-foreground: 218 10% 65%;

--accent: 45 90% 51%;
--accent-foreground: 222 24% 7%;

--destructive: 4 72% 51%;

--border: 218 15% 22%;
```

Не менять глобальную тему ради этого экрана.

---

# 36. GOLD USAGE

Gold использовать умеренно:

* primary CTA;
* selected status/filter;
* active navigation;
* important operational action;
* focus.

Не делать весь интерфейс жёлтым.

---

# 37. VISUAL DIRECTION

Продукт:

**AI Администратор**

Стиль:

**Premium Automotive B2B SaaS**

Характер:

* professional;
* operational;
* restrained;
* trustworthy;
* premium;
* technical.

Не использовать:

* cyberpunk;
* neon;
* gaming UI;
* excessive gradients;
* glassmorphism;
* giant decorative illustrations;
* excessive rounded cards.

---

# 38. COMPONENT REUSE

Использовать существующие:

* AppShell;
* Sidebar;
* Header;
* PageContainer;
* PageHeader;
* Card;
* Badge;
* Button;
* Input;
* Select;
* Dialog;
* Sheet;
* Skeleton;
* pagination;
* API utilities;
* existing status mapping;
* existing toast/error system.

Не устанавливать новые dependencies.

---

# 39. ACCESSIBILITY

Обязательно:

* semantic buttons;
* labels;
* keyboard navigation;
* visible focus;
* sufficient contrast;
* accessible status indicators;
* no color-only meaning;
* touch-friendly mobile controls.

---

# 40. ROUTING / NAVIGATION

Проверить AppShell / Sidebar.

Если раздел Requests уже существует:

использовать существующий navigation item.

Если нет:

добавить минимально необходимый navigation item.

Не менять существующую IA без необходимости.

---

# 41. CROSS-NAVIGATION

Проверить следующие связи:

```text
Request → Client
Request → Vehicle
Request → Conversation
Request → Service
```

Каждый переход должен использовать существующий route/flow.

Не создавать duplicate detail screens.

---

# 42. DATA INTEGRITY

Никаких fake data.

Никаких:

* mock requests;
* fake statuses;
* fake customers;
* fake vehicles;
* fake services;
* fake conversations;
* fake counters.

Все отображаемые operational data должны приходить из реального backend.

---

# 43. BACKEND PROTECTION

После реализации обязательно:

```bash
git diff
```

Проверить, что не изменены:

* Prisma;
* migrations;
* unrelated backend;
* Telegram;
* AI;
* Conversation business logic.

Если backend пришлось изменить:

НЕ продолжай автоматически.

Зафиксируй:

1. какой capability отсутствовал;
2. почему frontend-only реализация невозможна;
3. какие минимальные backend changes потребовались.

---

# 44. FILE SCOPE

Предпочтительно менять только:

* Requests page;
* Requests components;
* shared request UI;
* необходимые routing/navigation files.

Не переписывать:

* Dashboard;
* Conversations;
* Conversation Detail;
* Clients;
* Client Detail;
* Telegram;
* AI.

Исключение — минимальная cross-navigation, если она действительно необходима.

---

# 45. VALIDATION

После реализации выполнить:

```bash
npx tsc --noEmit
```

затем:

```bash
npm run build
```

затем существующий test suite.

Ожидается:

```text
TypeScript PASS
Build PASS
Tests PASS
```

Не изменять тесты только для того, чтобы они прошли.

---

# 46. MANUAL REVIEW

Проверить:

## Desktop

* `/requests`;
* list;
* search;
* status filter;
* pagination;
* request detail;
* customer;
* vehicle;
* service;
* conversation;
* status change;
* create, если существует;
* loading;
* empty;
* errors.

## Mobile

* request cards;
* detail;
* status;
* actions;
* no horizontal overflow.

## Navigation

Проверить:

```text
Clients → Request
Request → Client
Request → Conversation
Conversation → Request
```

только там, где соответствующие связи реально существуют.

---

# 47. GIT

После успешной реализации:

```bash
git status
git diff
```

Создать commit:

```text
feat: build customer requests v1
```

Если remote настроен:

```bash
git push
```

Не использовать force push.

---

# 48. FINAL REPORT

Создать:

```text
docs/final-reports/final-report-24.md
```

Отчёт должен содержать:

## 1. Summary

Что реализовано.

## 2. Audit Findings

Какая реальная модель CustomerRequest обнаружена.

Указать:

* fields;
* relations;
* enum/statuses;
* API operations.

## 3. Files Changed

Все изменённые/созданные файлы.

## 4. Existing Architecture Reused

Какие существующие:

* components;
* hooks;
* API utilities;
* routes;
* UI primitives

были переиспользованы.

## 5. Request List

Описать:

* columns/cards;
* search;
* filters;
* pagination.

## 6. Request Detail

Описать:

* request information;
* customer;
* vehicle;
* service;
* conversation;
* escalation;
* actions.

## 7. Create/Edit

Указать, реализованы ли они и какие существующие API использованы.

## 8. Cross-Navigation

Перечислить реальные переходы.

## 9. Data Sources

Указать точные endpoints.

## 10. N+1 Review

Объяснить:

* сколько запросов выполняется для list;
* сколько для detail;
* почему это не N+1.

## 11. Backend Changes

Явно указать:

```text
No backend changes.
```

если backend действительно не менялся.

Если backend изменялся — перечислить каждый файл и причину.

## 12. Database

Указать:

```text
No Prisma schema changes.
No migrations.
```

если это действительно так.

## 13. AI Isolation

Указать:

```text
No AI behavior changes.
```

если AI не изменялся.

## 14. Validation

* TypeScript;
* build;
* tests.

## 15. Git

* commit hash;
* commit message;
* push status;
* working tree status.

## 16. Limitations / Technical Debt

Честно перечислить:

* API limitations;
* pagination limitations;
* missing relations;
* отсутствующие routes;
* screenshot validation limitations;
* другие ограничения.

---

# 49. КРИТЕРИИ ГОТОВНОСТИ

Prompt 24 считается выполненным только если:

1. `/requests` является рабочим operational screen;
2. реальная CustomerRequest model проаудирована;
3. используются реальные API;
4. используются реальные статусы;
5. нет fake data;
6. list работает;
7. search работает либо ограничение API зафиксировано;
8. pagination работает;
9. status filter работает, если status существует;
10. detail работает;
11. customer context работает;
12. vehicle context работает, если relationship существует;
13. service context работает, если relationship существует;
14. conversation navigation работает, если связь существует;
15. status change работает, если существующий API позволяет это;
16. create/edit не ломают существующие flows;
17. нет N+1;
18. mobile layout работает;
19. loading/empty/error states обработаны;
20. backend не изменён без объективной необходимости;
21. Prisma не изменён;
22. migrations отсутствуют;
23. AI behavior не изменён;
24. TypeScript проходит;
25. build проходит;
26. tests проходят;
27. Git commit создан;
28. Final Report создан.

---

# 50. STOP CONDITION

После выполнения Prompt 24:

**НЕ переходи автоматически к Prompt 25.**

Остановись.

Создай:

```text
docs/final-reports/final-report-24.md
```

и выведи его содержимое в финальном ответе.

Мы отдельно проверим результат перед следующим этапом.

Главный принцип Prompt 24:

> **Сначала понять реальную CustomerRequest architecture. Затем строить UI. Не придумывать backend-модель под красивый интерфейс.**
