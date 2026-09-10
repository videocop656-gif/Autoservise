# Prompt 25 — Operational Work Queue v1

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# PROMPT 25 — Operational Work Queue v1

## Контекст проекта

Мы продолжаем разработку production-oriented SaaS для администратора автосервиса.

Уже реализованы и приняты:

* Dashboard / существующая главная рабочая область
* `/conversations` — список диалогов + Conversation Detail v1
* `/clients` — список клиентов + Client Detail v1
* `/requests` — канонический список Customer Requests + Request Detail v1

Последние реализации намеренно использовали существующие backend/API/Prisma-модели без изменения схемы.

### Важный принцип

Сейчас НЕ нужно делать очередной независимый CRUD-экран.

Следующая задача — создать **операционный workflow layer**: единое рабочее место администратора, где видно, что требует действия, и из которого можно быстро перейти к реальной сущности и выполнить действие.

Не придумывай новые бизнес-сущности, статусы, SLA, priority, задачи или fake data, если их нет в текущей модели.

---

# Цель Prompt 25

Создать **Operational Work Queue v1** — рабочую очередь администратора.

Она должна отвечать на три практических вопроса:

1. Что сейчас требует моего внимания?
2. Что уже находится в работе / ожидает дальнейшего действия?
3. Куда мне перейти, чтобы выполнить это действие?

Это не отдельная "аналитическая" страница и не dashboard с красивыми цифрами.

Это именно **рабочий operational screen**.

---

# STEP 1 — ОБЯЗАТЕЛЬНЫЙ АУДИТ ПЕРЕД КОДОМ

Перед изменением кода изучи существующий проект.

Проверь:

### Backend/API

Найди и изучи существующие endpoints, связанные с:

* Customer Requests
* Conversations
* Messages
* Escalations / AI Escalations
* Customers
* Vehicles
* Service History
* Dashboard / existing summary endpoints
* timestamps / updatedAt / createdAt
* attention / unread / status / assignment fields, если они реально существуют

Особенно проверь:

* какие реальные поля доступны;
* какие реальные статусы существуют;
* какие реальные переходы между статусами поддерживаются;
* есть ли реальные признаки "требует внимания";
* есть ли реальные признаки ответа администратора;
* есть ли реальные escalation records;
* какие поля можно использовать для сортировки;
* какие данные уже агрегируются backend;
* какие endpoints поддерживают pagination/filtering.

### Prisma

Проверь существующие модели и relations.

Особенно:

* CustomerRequest
* Conversation
* Message
* Customer
* Vehicle
* CustomerRequest ↔ Conversation
* Conversation ↔ Escalation / AiLog, если существует
* любые поля вроде status, createdAt, updatedAt, lastMessageAt, direction, senderType, attention и т.п.

### Frontend

Изучи:

* существующий Dashboard;
* `/requests`;
* `/conversations`;
* `/clients`;
* существующую navigation;
* существующие UI primitives;
* существующие loading/error/empty states;
* существующие форматтеры дат/статусов;
* существующие API helpers.

Не создавай вторую систему UI поверх уже существующей.

---

# STEP 2 — НЕ ПРИДУМЫВАЙ OPERATIONAL LOGIC

После аудита определи, какие реальные сигналы позволяют определить рабочую очередь.

Например, если в существующей модели реально есть:

* новые Customer Requests;
* Requests в определённых статусах;
* Conversations с реальным признаком attention/unread;
* реальные Escalations;
* сообщения, на которые действительно требуется ответ;
* recently updated records;

их можно использовать.

Но:

**не создавай искусственно:**

* `priority`;
* `urgent`;
* `overdue`;
* `SLA`;
* `assignedTo`;
* `task`;
* `needsAction`;
* `adminRequired`;

если соответствующих данных нет в backend.

Если существующая модель позволяет определить необходимость действия только косвенно, используй только объективное и объяснимое правило.

Например:

> Customer Request со статусом X

может попасть в очередь, если это действительно следует из существующей бизнес-логики.

Не делай:

> "NEW = срочно"

если срочность нигде не определена.

---

# STEP 3 — ОПРЕДЕЛИТЬ КАНОНИЧЕСКИЙ ROUTE

Проверь существующую информационную архитектуру.

Если подходящего operational route ещё нет, создай:

`/operations`

или наиболее логичное название, которое соответствует уже существующей navigation.

Не создавай одновременно несколько похожих routes:

* `/tasks`
* `/work-queue`
* `/operations`
* `/action-center`

Нужен **один canonical route**.

Добавь его в существующую navigation только если это соответствует текущей структуре приложения.

---

# STEP 4 — СТРУКТУРА ЭКРАНА

Создай Operational Work Queue v1.

Экран должен быть компактным и рабочим.

Рекомендуемая структура:

## Header

Название:

**Рабочая очередь**

Короткое пояснение:

> Здесь собраны обращения и события, которые требуют внимания администратора.

Но текст адаптируй к реальной логике после аудита.

Не используй маркетинговые формулировки.

---

## Section 1 — Требует внимания

Главный блок страницы.

Здесь должны находиться реальные записи, для которых существует объективный operational reason для действия.

Каждая строка / карточка должна содержать только реально доступные данные.

Например, если доступны:

* тип сущности;
* клиент;
* автомобиль;
* краткое содержание;
* статус;
* время последнего изменения;
* источник;
* escalation;

покажи их.

Не создавай данные специально для дизайна.

### Каждая запись должна иметь понятный CTA

Например:

* Открыть заявку
* Открыть диалог
* Открыть клиента

CTA должен вести в уже существующий экран:

* `/requests`
* `/conversations`
* `/clients`

или существующий detail state этих экранов.

Не создавай новый detail screen только ради Work Queue.

---

# Section 2 — Новые / входящие обращения

Если существующие данные позволяют объективно выделить новые обращения, покажи отдельный компактный блок.

Например:

* новые Customer Requests;
* новые Conversations;
* другие реальные входящие сущности.

Но сначала проверь модель.

Если раздел невозможно корректно определить из существующих данных — **не создавай его искусственно**.

---

# Section 3 — Ожидают дальнейшего действия

Если существующие статусы позволяют объективно определить такие записи, покажи их.

Например, только если это соответствует реальной бизнес-логике:

* `WAITING_CUSTOMER`;
* `IN_PROGRESS`;
* другие существующие статусы.

Не переименовывай реальные статусы в новые бизнес-статусы.

Можно использовать пользовательский label в UI, но исходное значение должно оставаться реальным.

---

# Section 4 — Эскалации

Если существующий backend действительно содержит Escalations:

покажи компактный список актуальных escalation records.

Для каждой записи:

* причина, если есть;
* summary, если есть;
* связанная conversation/request;
* время;
* статус, если он реально существует.

CTA:

**Открыть диалог**

или соответствующий существующий detail route.

Если Escalations в текущей системе не имеют полноценного lifecycle/status, не придумывай его.

---

# STEP 5 — ПУСТЫЕ СОСТОЯНИЯ

Каждый operational section должен иметь честный empty state.

Например:

> Сейчас ничего не требует внимания.

Но текст должен соответствовать фактическому смыслу блока.

Не показывай:

* fake records;
* placeholders pretending to be real data;
* случайные имена клиентов;
* фиктивные автомобили;
* demo conversations.

---

# STEP 6 — LOADING / ERROR STATES

Используй существующую систему loading/error states проекта.

Не создавай новую систему уведомлений без необходимости.

При ошибке API пользователь должен понимать:

* какой блок не загрузился;
* что данные временно недоступны.

Не скрывай backend errors молча.

---

# STEP 7 — DATA FETCHING

Это критически важно.

Не делай N+1.

Нельзя:

```text
load requests
→ for each request load customer
→ for each request load vehicle
→ for each request load conversation
→ for each conversation load escalation
```

Это запрещено.

Используй существующие bulk/reference endpoints.

Если существующие endpoints уже позволяют получить необходимые данные — используй их.

Если данных недостаточно для корректного Work Queue:

### сначала остановись и зафиксируй gap.

Не добавляй backend endpoint или Prisma relation автоматически.

Сначала в Final Report укажи:

* каких данных не хватает;
* какой существующий endpoint проверен;
* почему frontend-only реализация невозможна.

Backend изменение допустимо только если оно объективно необходимо и полностью обосновано текущей архитектурой.

---

# STEP 8 — СОРТИРОВКА

Используй только реальные timestamps.

Предпочтительно:

* newest relevant first;
* наиболее актуальное изменение сверху.

Не создавай artificial priority ordering.

Если разные типы сущностей невозможно честно сравнить по времени — раздели их на независимые секции.

---

# STEP 9 — CROSS-NAVIGATION

Operational Work Queue должен стать точкой входа в уже созданную систему.

Проверь и реализуй:

### Work Queue → Request

Открывает существующий Request Detail.

### Work Queue → Conversation

Открывает существующий Conversation Detail.

### Work Queue → Client

Открывает существующий Client Detail.

Не дублируй detail UI внутри Work Queue.

---

# STEP 10 — STATUS ACTIONS

Если для конкретной записи уже существует безопасное действие через существующий API, можно дать быстрый action прямо из очереди.

Например:

* изменить Customer Request status;
* закрыть/reopen Conversation;

НО только если:

1. такой mutation уже существует;
2. он уже используется в текущем UI;
3. semantics действия однозначна.

Не добавляй новые mutation endpoints.

Не добавляй новые статусы.

Не добавляй bulk actions в v1.

---

# STEP 11 — RESPONSIVE

Экран должен нормально работать:

### Desktop

* полноценная рабочая очередь;
* несколько колонок/секций при необходимости;
* читаемая иерархия.

### Mobile

* одна колонка;
* карточки/строки не должны ломаться;
* CTA доступны без горизонтального скролла.

Используй существующие responsive patterns проекта.

---

# STEP 12 — UI/UX

Не превращай страницу в dashboard из больших цветных карточек.

Главный принцип:

**операционная плотность + читаемость.**

Администратор должен за несколько секунд понять:

* что произошло;
* с кем;
* что нужно сделать;
* куда нажать.

Используй существующие:

* typography;
* spacing;
* borders;
* cards;
* badges;
* buttons;
* icons;
* status colors.

Не вводи новую визуальную систему.

---

# STEP 13 — НЕ ДЕЛАТЬ

В рамках Prompt 25 НЕ делать:

* новые Prisma models;
* новые workflow entities;
* новые priority levels;
* SLA;
* assignments;
* notifications;
* email;
* SMS;
* Telegram integration;
* AI behavior changes;
* автоматические действия;
* background jobs;
* cron;
* analytics dashboard;
* charts;
* fake demo data;
* новый CRM;
* отдельный task management system.

Также не переписывай существующие:

* Clients;
* Requests;
* Conversations;
* Dashboard

без необходимости.

---

# STEP 14 — TESTING

После реализации обязательно:

```bash
npx tsc --noEmit
```

и существующий build:

```bash
npm run build
```

Также запусти существующий test suite.

Если есть:

```bash
npm test
```

используй его.

Если проект использует другую команду — используй существующую.

Проверь минимум:

1. `/operations` открывается.
2. Реальные данные загружаются.
3. Empty states работают.
4. API errors не ломают весь экран.
5. Request CTA открывает существующий Request Detail.
6. Conversation CTA открывает существующий Conversation Detail.
7. Client CTA открывает существующий Client Detail.
8. Нет N+1.
9. Нет fake data.
10. Existing routes `/requests`, `/conversations`, `/clients` продолжают работать.
11. Existing tests не регрессировали.
12. TypeScript и production build проходят.

---

# STEP 15 — GIT

После успешной проверки создай отдельный commit.

Commit message:

```text
feat: add operational work queue v1
```

Если в проекте используется другой стандарт commit messages, следуй существующему стандарту.

После commit проверь:

```bash
git status
```

Рабочее дерево должно быть clean.

---

# FINAL REPORT

После выполнения НЕ продолжай автоматически следующую задачу.

Остановись и подготовь подробный Final Report.

Структура:

## Final Report — Prompt 25: Operational Work Queue v1

### 1. Result

Что именно реализовано.

### 2. Operational Logic

Какие реальные данные используются для определения:

* требует внимания;
* новые обращения;
* ожидают действия;
* escalation.

Для каждого правила укажи конкретные существующие поля/statuses.

Если какой-то раздел не удалось сделать честно — укажи это.

### 3. Files Changed

Полный список изменённых/созданных файлов с кратким назначением.

### 4. API Used

Перечисли существующие endpoints, которые использованы.

Отдельно укажи, были ли изменения backend.

### 5. Prisma

Укажи:

* менялась ли schema;
* были ли migrations.

Если нет:

> No Prisma schema changes. No migrations.

### 6. N+1 Audit

Объясни, как загружаются данные и почему нет N+1.

### 7. Cross-navigation

Отметь:

* Work Queue → Request
* Work Queue → Conversation
* Work Queue → Client

### 8. Responsive

Что сделано для desktop/mobile.

### 9. Validation

Результаты:

* TypeScript
* Build
* Tests

С реальными цифрами.

### 10. Git

Укажи commit hash и message.

### 11. Limitations

Только реальные ограничения.

Не скрывай ограничения и не компенсируй их fake UI.

### 12. Screenshot

Если визуальная проверка невозможна из-за отсутствия screenshot — прямо напиши:

> No screenshot validation performed.

Не утверждай, что UI визуально проверен, если этого не было.

---

# STOP CONDITION

После Final Report остановись.

Не переходи к Prompt 26.

Не добавляй дополнительные features "заодно".

Не исправляй unrelated issues.

Главная цель Prompt 25:

**связать уже существующие Requests, Conversations, Clients и Escalations в единый operational workflow без выдумывания новой бизнес-логики.**
