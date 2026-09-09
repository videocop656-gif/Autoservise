# Prompt 21 — Conversations Inbox v1

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# PROMPT 21 — Conversations v1: рабочий экран диалогов

## ROLE

Ты работаешь как senior frontend engineer + product UI engineer.

Мы продолжаем разработку существующего SaaS-продукта **AI Администратор** для автосервисов.

Выполнены:

* Prompts 1–18 — backend, AI foundation, channels, Telegram integration и бизнес-логика;
* Prompt 19 — новый frontend AppShell + dark graphite / premium gold design system;
* Prompt 20 — operational Dashboard v1.

Сейчас задача — создать полноценный рабочий экран:

```text
/conversations
```

Это **не новый backend-модуль**.

Нужно построить frontend поверх уже существующих API и data layer.

---

# 1. ГЛАВНОЕ ПРАВИЛО

**НЕ изменяй backend.**

Не изменяй:

* Prisma schema;
* database;
* migrations;
* Telegram integration;
* ChannelDelivery;
* Conversation business logic;
* Message business logic;
* AI logic;
* authentication;
* существующие API contracts;
* server services.

Не создавай новый backend endpoint только ради UI.

Сначала изучи существующий backend/frontend и используй уже существующие возможности.

---

# 2. СНАЧАЛА AUDIT

Перед кодированием изучи:

* текущий `src/pages/...` экран conversations, если он существует;
* `src/App.tsx`;
* `AppShell`;
* `PageContainer`;
* `PageHeader`;
* существующие UI components;
* существующие API helpers/services/hooks;
* TypeScript types;
* backend route для conversations;
* backend route для conversation detail;
* существующие Message/Conversation DTO;
* существующие customer/channel/status structures.

Особенно проверь, что реально возвращает:

```text
GET /api/conversations
```

и какие endpoint(s) используются для конкретного conversation.

**Не предполагай структуру ответа.**

---

# 3. ЦЕЛЬ ЭКРАНА

Экран должен позволять администратору быстро понять:

1. кто написал;
2. когда было последнее обращение;
3. через какой канал;
4. что происходит с диалогом;
5. работает ли AI;
6. требуется ли человек;
7. открыть конкретный диалог.

Это должен быть **рабочий inbox**, а не декоративный список.

---

# 4. ОСНОВНАЯ СТРУКТУРА

Создай:

```text
Conversations

Page Header
    title
    description

Toolbar
    Search
    Status filter
    Channel filter
    Attention filter

Conversation List
    Conversation row
    Conversation row
    Conversation row
    ...

Pagination / loading / empty state
```

На desktop список должен быть основным содержимым страницы.

Не создавай пока полноценный split-screen chat detail.

**Conversation Detail будет отдельной задачей позже.**

---

# 5. PAGE HEADER

Используй существующий:

```text
PageHeader
```

Заголовок:

**Обращения**

Краткое описание:

> Все обращения клиентов в одном месте

Не добавляй длинный marketing copy.

---

# 6. SEARCH

Добавь поиск, если существующий API поддерживает поиск.

Перед реализацией проверь API.

Если backend уже поддерживает search parameter — используй его.

Если backend **не поддерживает server-side search**:

не создавай новый endpoint.

Можно использовать существующую client-side filtering strategy, только если список уже полностью доступен.

Не загружай искусственно тысячи записей ради поиска.

Если полноценный поиск пока невозможно сделать честно — реализуй UI как disabled/unavailable state либо ограниченный поиск по реально загруженным данным и зафиксируй ограничение в Final Report.

---

# 7. FILTERS

Проверь реальные API parameters и существующие статусы.

Используй только реально существующие значения.

Предусмотри, насколько позволяет существующий API:

### Статус

Например:

* Все
* Открытые
* В работе
* Закрытые

Но **не придумывай enum**.

Сначала найди существующий Conversation status.

---

### Канал

Если Conversation связан с Channel:

используй реальные channel types.

Например Telegram — только если он реально представлен в существующей модели.

Не hardcode список каналов, если его можно получить из существующего API.

---

### Требует внимания

Если существующая архитектура позволяет определить escalation/human attention:

добавь фильтр.

Если нет — не создавай новую бизнес-логику.

---

# 8. CONVERSATION ROW

Каждая строка должна быть компактной и информативной.

Предпочтительная структура:

```text
[Avatar/Icon]   Client name
                Short metadata

                Channel • status • time

                                      Attention / AI
```

Но используй только реально доступные поля.

---

# 9. CLIENT IDENTITY

Если conversation уже связан с customer:

показывай:

* имя клиента;
* телефон — только если существующая UI/политика его уже показывает;
* другой безопасный идентификатор при необходимости.

Не показывай внутренние database IDs пользователю, если они не предназначены для UI.

Если имя невозможно определить:

используй нейтральный fallback.

Например:

**Неизвестный клиент**

Но не выдумывай имя.

---

# 10. CHANNEL

Показывай канал разговора компактно.

Например:

```text
Telegram
```

и небольшую lucide icon, если подходящая уже есть.

Не используй огромные channel logos.

Не создавай отдельную цветовую схему для каждого канала.

---

# 11. STATUS

Показывай существующий conversation status через:

* Badge;
* muted text;
* небольшой status indicator.

Используй существующий `Badge`.

Не создавай новые визуальные компоненты без необходимости.

---

# 12. AI / HUMAN STATE

Если существующие данные позволяют определить:

* AI handled;
* human intervention;
* escalation;

показывай это.

Например:

```text
AI
```

или:

```text
Требует внимания
```

Но только если это основано на реальном поле/API.

Не выводи:

**AI обработал**

только потому, что conversation существует.

---

# 13. ATTENTION STATE

Диалоги, требующие внимания человека, должны визуально выделяться.

Но restrained.

Используй:

* warning;
* destructive только для действительно критического состояния;
* небольшую badge;
* небольшой indicator.

Не красить всю строку в красный.

---

# 14. LAST ACTIVITY

Если API возвращает:

* `updatedAt`;
* `lastMessageAt`;
* другой существующий timestamp;

используй его.

Формат должен быть удобным для человека:

Например:

```text
Сегодня, 14:32
```

или:

```text
5 мин назад
```

Используй существующий utility, если он уже есть.

Не создавай разные форматы времени на разных строках.

---

# 15. MESSAGE PREVIEW

Очень важно:

Сначала проверь, возвращает ли:

```text
GET /api/conversations
```

текст последнего сообщения.

### Если возвращает

Покажи короткий preview:

```text
Здравствуйте, хочу записаться...
```

Обрезай длинный текст.

### Если НЕ возвращает

Не делай N дополнительных запросов для каждой строки.

Не создавай fake preview.

Просто показывай metadata;

* клиент;
* канал;
* статус;
* время.

И зафиксируй ограничение в Final Report.

---

# 16. CLICK BEHAVIOR

При клике на conversation:

перейти на будущий/существующий detail route, **только если такой route уже существует**.

Сначала проверь `App.tsx` и существующие routes.

Если detail route уже есть:

используй его.

Если detail route ещё отсутствует:

не создавай полноценный detail screen в Prompt 21.

Можно сделать строку visually clickable и подготовить routing only if architecture already supports it.

Если нужен новый detail route — зафиксируй это как следующий шаг.

---

# 17. PAGINATION

Обязательно изучи существующий endpoint.

Если:

```text
GET /api/conversations
```

поддерживает:

* page;
* pageSize;
* cursor;
* offset;

используй существующую pagination mechanism.

Не создавай новую backend pagination.

Если текущий API уже использует page/pageSize:

сделай соответствующие controls.

---

# 18. LOADING

Во время загрузки:

используй skeleton или аккуратный loading state.

Не показывай пустой список до окончания загрузки.

---

# 19. EMPTY STATE

Если conversations действительно нет:

покажи:

**Обращений пока нет**

и короткое пояснение.

Не создавать fake conversations.

---

# 20. FILTER EMPTY STATE

Если поиск/фильтр не дал результатов:

отдельное состояние:

**Ничего не найдено**

и:

**Попробуйте изменить параметры поиска или фильтра.**

Если применён фильтр, можно дать:

**Сбросить фильтры**

---

# 21. ERROR STATE

Если API не загрузился:

покажи:

**Не удалось загрузить обращения**

и кнопку:

**Повторить**

Не показывай:

* stack trace;
* raw API response;
* internal errors.

---

# 22. DESIGN SYSTEM

Используй Prompt 19 design system.

Основные токены:

```css
--background: 222 24% 7%;
--foreground: 0 0% 100%;

--card: 222 20% 12%;
--card-foreground: 0 0% 100%;

--primary: 45 90% 51%;
--primary-foreground: 222 24% 7%;

--muted: 222 16% 18%;
--muted-foreground: 218 10% 65%;

--destructive: 4 72% 51%;

--border: 218 15% 22%;

--success: 142 60% 45%;
--warning: 38 92% 50%;
--info: 210 80% 55%;
```

---

# 23. GOLD USAGE

Gold используется restrained.

Допустимо:

* active filter;
* primary action;
* focus;
* selected state;
* небольшая AI indicator;
* important attention indicator.

Не использовать gold:

* для каждой строки;
* для всех icons;
* для всех badges;
* для всех borders;
* как фон всей панели.

---

# 24. LIST VISUAL DESIGN

Список должен выглядеть как профессиональный B2B inbox.

Не делай каждую строку огромной отдельной карточкой.

Предпочтительно:

```text
Card container
────────────────────────────────
Row
────────────────────────────────
Row
────────────────────────────────
Row
────────────────────────────────
```

или аналогичная аккуратная структура.

Borders subtle.

Spacing consistent.

---

# 25. RESPONSIVE

### Desktop

Основной layout:

```text
Header

Toolbar

Conversation list
```

List занимает основное доступное пространство.

### Tablet

Toolbar может переноситься.

### Mobile

Toolbar:

```text
Search
Filters
```

спокойно переходят в вертикальный/scrollable layout.

Conversation row:

```text
Client
Channel / Status
Time
Attention
```

без горизонтального overflow.

---

# 26. MOBILE NAVIGATION

Не изменяй MobileNav/AppShell.

Используй уже существующую оболочку Prompt 19.

---

# 27. NO NEW DEPENDENCIES

Не устанавливать новые npm packages.

Использовать существующий:

* React;
* TypeScript;
* Vite;
* Tailwind;
* shadcn/ui;
* lucide-react.

---

# 28. TYPESCRIPT

Не использовать:

```ts
any
```

если можно использовать существующий тип.

Не дублировать backend models без необходимости.

---

# 29. DATA INTEGRITY

Критически важно:

**Никаких fake conversations.**

Не создавать:

```text
Иван Петров
Мария
Алексей
```

только ради красивого интерфейса.

Если база пустая — интерфейс должен выглядеть хорошо именно с пустой базой.

---

# 30. НЕ ТРОГАТЬ DASHBOARD

Prompt 21 не должен менять:

```text
/dashboard
```

кроме случаев, когда требуется общий shared component и изменение действительно безопасно.

В идеале изменять только Conversations-related frontend files.

---

# 31. НЕ ТРОГАТЬ BACKEND

После реализации должно быть:

```text
backend files changed: NO
database changed: NO
migrations: NO
API contracts changed: NO
```

Если обнаружится, что без backend изменения невозможно выполнить какую-либо функцию:

**не меняй backend.**

Запиши ограничение в Final Report.

---

# 32. IMPLEMENTATION ORDER

Работай строго по порядку.

### STEP 1 — Audit

Изучи:

* current Conversations page;
* API;
* types;
* routes;
* существующие components.

### STEP 2 — Data mapping

Определи:

```text
UI field → real data source
```

### STEP 3 — Page structure

Создай новый Conversations layout.

### STEP 4 — Toolbar

Search + реальные filters.

### STEP 5 — Conversation list

Real data only.

### STEP 6 — Status / channel / attention indicators

Только на основе существующих данных.

### STEP 7 — Loading / empty / error states

### STEP 8 — Pagination

Если поддерживается существующим API.

### STEP 9 — Responsive

### STEP 10 — Accessibility

### STEP 11 — Validation

---

# 33. VALIDATION

После реализации запусти:

```bash
npm run build
```

Проверь TypeScript.

Если в проекте существует test command — запусти существующие tests.

Особенно убедись, что:

* Dashboard не сломан;
* AppShell не сломан;
* Settings не сломаны;
* existing routes работают;
* backend regression tests остаются PASS.

---

# 34. FINAL REPORT

После завершения выдай:

## 1. Implemented

Что сделано.

## 2. Existing API Used

Какие реальные endpoints использованы.

## 3. Data Mapping

Какие поля UI откуда берутся.

## 4. Search / Filters

Какие фильтры реально поддерживаются API.

## 5. Pagination

Как реализована.

## 6. Empty / Loading / Error States

Что сделано.

## 7. Files Changed

Полный список.

## 8. Backend

```text
backend files changed: yes/no
database changed: yes/no
migrations: yes/no
API contracts changed: yes/no
```

## 9. Dependencies

```text
new dependencies: yes/no
```

## 10. Validation

Реальные результаты:

* TypeScript;
* build;
* tests.

## 11. Known Limitations

Только реальные ограничения.

## 12. Commit

Hash + commit message.

---

# 35. COMMIT

Если используется git:

```text
feat: build conversations inbox v1
```

---

# 36. DEFINITION OF DONE

Prompt 21 считается выполненным, если:

* `/conversations` больше не является старым/placeholder UI;
* используется существующий AppShell;
* используется утверждённая dark graphite / premium gold system;
* отображаются реальные conversations;
* fake data отсутствует;
* есть search, если его поддерживает существующая архитектура;
* есть реальные filters, если они поддерживаются;
* есть status;
* есть channel;
* есть attention state, если доступен;
* есть last activity;
* message preview показывается только если реально доступен;
* есть pagination, если поддерживается API;
* есть loading state;
* есть empty state;
* есть filtered-empty state;
* есть error state;
* mobile layout работает;
* нет horizontal overflow;
* accessibility соблюдена;
* backend не изменён;
* database не изменена;
* migrations не созданы;
* новые dependencies не добавлены;
* TypeScript PASS;
* build PASS;
* existing tests PASS.

**Не начинай Conversation Detail и не переходи к Prompt 22.**

После выполнения остановись и выдай Final Report.
