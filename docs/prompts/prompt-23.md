# Prompt 23 — Clients / Клиенты v1

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# PROMPT 23 — CLIENTS / КЛИЕНТЫ V1

## Роль

Ты работаешь как senior full-stack engineer в существующем production-oriented проекте:

**Autoservise / AI Администратор**

На предыдущих этапах уже реализованы:

* backend foundation;
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
* Conversations Inbox.

Сейчас необходимо реализовать полноценный operational экран:

# Клиенты / Clients v1

---

# 1. ГЛАВНАЯ ЦЕЛЬ

Создать рабочий frontend раздел **«Клиенты»**, который позволяет администратору автосервиса:

* видеть список клиентов;
* искать клиента;
* открывать карточку клиента;
* видеть его контактную информацию;
* видеть связанные автомобили;
* видеть обращения;
* видеть заявки/запросы;
* видеть историю обслуживания, если существующие API позволяют это сделать;
* переходить к связанным сущностям;
* использовать существующие backend API.

Это должен быть **реальный operational UI**, а не demo CRUD.

---

# 2. СНАЧАЛА ОБЯЗАТЕЛЬНЫЙ АУДИТ

Перед написанием кода сначала изучи существующую систему.

Найди и проанализируй:

* текущую страницу Clients/Customers;
* существующие компоненты клиентов;
* Customer API;
* Vehicle API;
* Customer Request API;
* Service History API;
* Conversation API;
* существующие UI primitives;
* существующие таблицы/lists/cards;
* существующую pagination;
* существующие search/filter patterns;
* AppShell;
* PageContainer;
* PageHeader;
* Dashboard;
* Conversations Inbox;
* Conversation Detail.

Особенно проверь реальные API contracts.

Не предполагай поля.

Не создавай frontend-модель, которой нет в backend.

---

# 3. КРИТИЧЕСКОЕ ПРАВИЛО

Не создавать новую backend-архитектуру.

В Prompt 23:

* не менять Prisma schema;
* не создавать migrations;
* не создавать новые backend endpoints;
* не менять существующие API contracts;
* не менять Telegram;
* не менять ChannelDelivery;
* не менять Conversation logic;
* не менять AI behavior.

Если существующих API недостаточно для какого-либо элемента интерфейса:

> НЕ ПРИДУМЫВАЙ данные.

Лучше показать честный empty state.

---

# 4. СУЩЕСТВУЮЩАЯ АРХИТЕКТУРА

Используй существующий маршрут:

```text
/clients
```

Если `/clients` уже существует — улучшить существующую страницу.

Не создавать второй маршрут.

Если старый маршрут существует в `/settings/customers` или аналогичном месте:

* сохранить legacy redirect;
* `/clients` должен стать canonical route;
* не создавать две независимые реализации.

---

# 5. ОСНОВНОЙ LAYOUT

Desktop:

```text
┌──────────────────────────────────────────────────────────────┐
│ Клиенты                                      [Search]        │
│ Все клиенты / фильтры                                       │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ Client             Phone       Vehicles   Requests   Status │
│ Иван Петров        +7...       2          1          Active  │
│ Анна Смирнова      +7...       1          0          Active  │
│ Сергей Иванов      +7...       3          2          Active  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

Это только концепция.

Используй реальные поля, которые доступны в существующем API.

---

# 6. CLIENT LIST

Список должен использовать существующий:

```text
GET /api/customers
```

или фактический endpoint, обнаруженный при аудите.

Не менять API.

---

# 7. COLUMNS / INFORMATION

Показывать только информацию, которая реально доступна.

Предпочтительный порядок:

### Клиент

* имя;
* фамилия;
* отображаемое полное имя.

### Контакты

Если реально доступны:

* phone;
* email.

### Автомобили

Количество связанных автомобилей, если его можно получить без N+1.

### Requests

Количество заявок, если оно доступно без N+1.

### Status

Только если реальный customer status существует.

Не создавать artificial "Active" только потому, что клиент существует.

---

# 8. SEARCH

Добавить поиск клиентов.

Использовать server-side search, если существующий API его поддерживает.

Если API не поддерживает поиск:

* не менять backend только ради Prompt 23;
* использовать существующий механизм;
* если допустимо по текущей архитектуре — фильтровать уже загруженный набор;
* обязательно зафиксировать ограничение в Final Report.

Поиск должен быть debounce примерно 300 ms, если используется server-side API.

---

# 9. PAGINATION

Использовать существующую pagination систему.

Не загружать бесконечный список клиентов.

Не использовать:

```text
pageSize=1000
```

для обхода pagination.

Если текущий API имеет page/pageSize:

использовать их.

---

# 10. FILTERS

Не добавлять искусственные фильтры.

Если существующие backend/API fields позволяют полезные фильтры — можно использовать.

Приоритет:

1. search;
2. pagination;
3. при наличии реальных данных — status;
4. при наличии реального API — другие operational filters.

Не создавать фильтр "AI status" только ради UI.

---

# 11. OPEN CLIENT DETAIL

При клике на клиента открыть его detail.

Предпочтительно использовать существующую архитектуру проекта.

Если в проекте уже используется inline detail:

```text
/clients
    ↓
Client list
    ↓
Client detail
```

сохранить этот подход.

Не создавать второй параллельный detail route без объективной необходимости.

---

# 12. CLIENT DETAIL

Detail должен показывать:

## Header

* back;
* client name;
* contact information;
* available actions.

Если существующая система поддерживает edit/delete:

использовать существующие API.

Не создавать новую CRUD business logic.

---

# 13. CUSTOMER INFORMATION

Показать реальные данные клиента:

```text
Имя
Телефон
Email
```

Дополнительные поля — только если существуют.

Не показывать пустые поля без необходимости.

---

# 14. VEHICLES

Показать связанные автомобили.

Например:

```text
Автомобили

Toyota Camry
2021
KZ 123 ABC

BMW X5
2019
KZ 456 XYZ
```

Но использовать только реальные поля из API.

Если автомобилей нет:

```text
Автомобилей пока нет
```

---

# 15. VEHICLE CARD

Каждый автомобиль должен быть отдельным компактным элементом.

Если существует возможность перейти к vehicle detail:

использовать существующий маршрут/flow.

Не создавать новый vehicle backend.

---

# 16. CUSTOMER REQUESTS

Показать существующие requests клиента.

Например:

```text
Заявки

Замена масла          OPEN
Диагностика тормозов  CLOSED
```

Использовать реальные данные.

При наличии существующего перехода — дать возможность открыть request.

---

# 17. CONVERSATIONS

Если существующий Conversation API позволяет получить связанные conversations без N+1:

показать блок:

```text
Обращения

Ремонт тормозной системы
Сегодня

Запись на ТО
Вчера
```

Клик должен вести в существующий:

```text
/conversations
```

и использовать существующий Conversation Detail flow.

Не создавать новую систему сообщений.

---

# 18. SERVICE HISTORY

Если существующий API позволяет получить историю обслуживания клиента:

показать компактный блок:

```text
История обслуживания

12.08.2026
Замена масла

03.05.2026
Диагностика тормозной системы
```

Если история не доступна через существующие API без чрезмерного количества запросов:

не реализовывать искусственную историю.

Показать:

```text
История обслуживания недоступна
```

или не показывать блок.

---

# 19. QUICK ACTIONS

Если существующие flows позволяют:

* новое обращение;
* новая заявка;
* добавить автомобиль;
* открыть conversation.

Но:

> Не создавать новые backend operations.

Показывать только реально работающие действия.

---

# 20. DATA LOADING

Для Client Detail не создавать cascade N+1.

Плохой вариант:

```text
load customer
→ load every vehicle
→ load every request
→ load every conversation
→ load every service history record
```

особенно если это делается отдельным запросом для каждого элемента.

---

# 21. N+1 POLICY

Перед реализацией определить:

Какие данные уже приходят из:

```text
GET /api/customers
GET /api/vehicles
GET /api/customer-requests
GET /api/conversations
GET /api/service-history
```

и какие можно использовать повторно.

Если несколько независимых запросов действительно необходимы:

использовать:

```text
Promise.all
```

или:

```text
Promise.allSettled
```

в зависимости от текущего error-handling pattern.

Не выполнять запросы внутри `.map()`.

---

# 22. EMPTY STATES

Обязательно обработать:

### Нет клиентов

```text
Клиентов пока нет
```

### Нет автомобилей

```text
Автомобилей у клиента пока нет
```

### Нет заявок

```text
Заявок пока нет
```

### Нет обращений

```text
Обращений пока нет
```

### Нет истории

```text
История обслуживания пока отсутствует
```

Формулировки адаптируй к существующему языку интерфейса.

---

# 23. LOADING STATES

Для списка:

* skeleton.

Для detail:

* skeleton.

Не показывать пустую страницу во время загрузки.

---

# 24. ERROR STATES

Если API не отвечает:

* понятное сообщение;
* retry, если существующий pattern проекта это поддерживает.

Не скрывать ошибки молча.

---

# 25. MOBILE

Mobile должен быть отдельным layout behavior.

Не уменьшенная desktop table.

На mobile:

```text
Client card
    ↓
Name
Phone
Vehicles
Requests
Status
```

Карточки идут одной колонкой.

При открытии:

```text
Header
↓
Customer information
↓
Vehicles
↓
Requests
↓
Conversations
↓
Service history
↓
Actions
```

Не использовать horizontal scrolling для основной информации.

---

# 26. TABLET

На tablet:

* список может оставаться compact;
* secondary columns можно скрывать;
* detail остаётся readable.

Использовать существующие Tailwind breakpoints.

---

# 27. DESIGN SYSTEM

Использовать утверждённую систему:

```css
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

---

# 28. GOLD USAGE

Gold использовать умеренно:

* primary CTA;
* active navigation;
* selected state;
* important action;
* focus;
* key operational highlight.

Не делать:

* gold background для всех cards;
* gold borders everywhere;
* gold icons everywhere;
* yellow/black overload.

---

# 29. VISUAL DIRECTION

Продукт:

**AI Администратор**

Style:

**Dark Graphite + Premium Gold**

Характер:

* premium automotive technology;
* B2B SaaS;
* professional;
* operational;
* trustworthy;
* restrained.

Не использовать:

* cyberpunk;
* gaming;
* neon;
* glassmorphism;
* excessive gradients;
* excessive rounded cards;
* huge decorative graphics.

---

# 30. COMPONENT REUSE

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
* Skeleton;
* Dialog/Sheet, если уже существуют;
* existing pagination;
* existing API utilities.

Не устанавливать новые зависимости.

---

# 31. ACCESSIBILITY

Обязательно:

* semantic buttons;
* labels;
* keyboard navigation;
* visible focus;
* sufficient contrast;
* accessible table/card interactions;
* no color-only status indicators.

---

# 32. DATA INTEGRITY

Никаких:

* fake clients;
* fake vehicles;
* fake requests;
* fake conversations;
* fake service history;
* fake statuses;
* fake counters.

Все данные должны быть реальными.

---

# 33. BACKEND PROTECTION

Перед завершением выполнить проверку:

```text
git diff
```

Убедиться, что не изменены:

* Prisma;
* migrations;
* server API;
* Telegram;
* AI;
* authentication.

Если backend неожиданно пришлось изменить:

остановись и объясни почему.

Не продолжай автоматически.

---

# 34. FILE SCOPE

Предпочтительно изменять только frontend-файлы, относящиеся к Clients.

Не переписывать:

* Dashboard;
* Conversations;
* Conversation Detail;
* Telegram;
* unrelated settings;
* AppShell,

если это не требуется для корректного `/clients`.

---

# 35. VALIDATION

После реализации:

```bash
npx tsc --noEmit
```

затем:

```bash
npm run build
```

затем существующий test suite.

Ожидается отсутствие regressions.

Не изменять тесты только для того, чтобы они прошли.

---

# 36. MANUAL REVIEW

Перед завершением проверить:

## Desktop

* list;
* search;
* pagination;
* client detail;
* vehicles;
* requests;
* conversations;
* service history;
* actions.

## Mobile

* cards;
* detail;
* no horizontal overflow;
* readable text;
* touch-friendly actions.

## Data

* no fake data;
* no N+1;
* correct API usage;
* no duplicated logic.

---

# 37. GIT

После успешной реализации:

```bash
git status
git diff
```

Создать commit:

```text
feat: build clients v1
```

Если remote настроен:

```bash
git push
```

Не использовать force push.

---

# 38. FINAL REPORT

Создать:

```text
docs/final-reports/final-report-23.md
```

Отчёт должен содержать:

## 1. Summary

Что реализовано.

## 2. Files Changed

Все изменённые/созданные файлы.

## 3. Existing Architecture Reused

Какие существующие компоненты и API использованы.

## 4. Client List

Search, pagination, filters, columns/cards.

## 5. Client Detail

Customer information, vehicles, requests, conversations, service history.

## 6. Responsive

Desktop / tablet / mobile.

## 7. Data Sources

Точные endpoints.

## 8. N+1 Review

Какие запросы выполняются и почему это не N+1.

## 9. Backend Changes

Явно указать:

```text
No backend changes.
```

если backend действительно не менялся.

## 10. Database

```text
No Prisma schema changes.
No migrations.
```

если это действительно так.

## 11. AI Isolation

```text
No AI behavior changes.
```

если AI не изменялся.

## 12. Validation

* TypeScript;
* build;
* tests.

## 13. Git

* commit hash;
* commit message;
* push status;
* working tree status.

## 14. Limitations / Technical Debt

Честно перечислить все ограничения.

---

# 39. КРИТЕРИИ ГОТОВНОСТИ

Prompt 23 считается выполненным только если:

1. `/clients` является рабочим экраном;
2. используется существующий Customer API;
3. поиск работает либо честно отражено ограничение API;
4. pagination работает;
5. client detail работает;
6. реальные vehicles отображаются;
7. реальные requests отображаются;
8. conversations отображаются только при наличии корректного существующего API;
9. service history не выдумывается;
10. нет N+1;
11. mobile layout работает;
12. backend не изменён;
13. Prisma не изменён;
14. migrations отсутствуют;
15. AI behavior не изменён;
16. TypeScript проходит;
17. build проходит;
18. tests проходят;
19. Git commit создан;
20. Final Report создан.

---

# RESULT

После Prompt 23 продукт должен иметь полноценный operational раздел:

**Клиенты**

который связывает:

**Клиент → Автомобили → Заявки → Обращения → История обслуживания**

и использует существующую backend-архитектуру без создания параллельных систем.

Не делай demo.

Не придумывай данные.

Не расширяй backend без необходимости.

Сначала изучи существующую систему, затем реализуй frontend.
