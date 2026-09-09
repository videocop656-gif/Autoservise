# Prompt 22 — Conversation Detail v1

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).
> This replaces an earlier condensed version of this file that was
> written before the full prompt text below was given.

---

# PROMPT 22 — CONVERSATION DETAIL V1

## Роль

Ты работаешь как senior full-stack engineer в уже существующем production-oriented проекте **Autoservise / AI Администратор**.

Проект уже имеет работающий frontend, backend, Prisma/Supabase, Telegram integration, AppShell и operational Conversations Inbox.

Твоя задача — **улучшить существующий экран/панель Conversation Detail**, а не создавать параллельную или вторую реализацию.

---

# 1. ГЛАВНАЯ ЦЕЛЬ

Сделать Conversation Detail полноценным operational screen для работы администратора автосервиса.

Пользователь должен видеть:

* с кем он разговаривает;
* статус обращения;
* историю сообщений;
* кто отправил сообщение — клиент или AI/администратор, если это можно определить из существующих реальных данных;
* возможность ответить клиенту существующим способом;
* информацию о клиенте;
* автомобиль;
* запрос/услугу;
* escalation/attention;
* AI status, если такие данные реально существуют.

Главный принцип:

> Используй существующую архитектуру, существующие API и существующие данные. Не придумывай новые сущности и не имитируй данные.

---

# 2. ОБЯЗАТЕЛЬНО: СНАЧАЛА АУДИТ

Перед изменением кода сначала изучи существующую реализацию.

Обязательно найди и проанализируй:

* текущий Conversations Inbox;
* текущий Conversation Detail;
* компонент/компоненты сообщений;
* composer;
* существующую отправку сообщения;
* API `/api/conversations/:id`;
* API отправки сообщений;
* `channelDeliveryService`;
* Telegram channel integration;
* customer API;
* vehicle API;
* customer-request API;
* escalation API;
* существующие AI-related API/данные.

Особенно важно понять, является ли текущий Conversation Detail:

1. inline panel;
2. drawer;
3. отдельной страницей;
4. комбинацией нескольких компонентов.

### НЕ меняй архитектуру без необходимости.

Если текущая архитектура использует inline detail panel внутри `/conversations`, сохрани её.

Не создавай второй `/conversation/:id`, если для этого нет объективной архитектурной необходимости.

---

# 3. НЕ ТРОГАТЬ BACKEND

В рамках Prompt 22:

* не менять backend;
* не менять Prisma schema;
* не создавать migrations;
* не менять API contracts;
* не менять Telegram adapter;
* не менять ChannelDelivery;
* не менять authentication;
* не менять AI behavior;
* не добавлять новые server endpoints.

Если существующих данных недостаточно для какого-либо UI-элемента:

> НЕ ПРИДУМЫВАЙ ДАННЫЕ.

Лучше не показывать поле, чем показывать fake data.

---

# 4. DESKTOP LAYOUT

На desktop Conversation Detail должен выглядеть как полноценный рабочий экран.

Предпочтительная структура:

```text
┌─────────────────────────────────────────────────────────────┐
│ Back to conversations                                      │
│ Client name · Subject                    Status   Close    │
├───────────────────────────────────────────────┬─────────────┤
│                                               │             │
│                 MESSAGE THREAD                │   CONTEXT   │
│                                               │             │
│ Customer message                             │ Customer    │
│                                               │ Vehicle     │
│                         AI/Admin message      │ Request     │
│                                               │ Escalation  │
│ Customer message                             │ AI status   │
│                                               │             │
│                                               │             │
├───────────────────────────────────────────────┴─────────────┤
│ Message composer                              Send           │
└─────────────────────────────────────────────────────────────┘
```

Не обязательно повторять схему буквально.

Используй существующий AppShell, PageContainer и существующую дизайн-систему.

---

# 5. HEADER

В верхней части Conversation Detail:

### Левая часть

Кнопка:

**Back to Conversations**

Она должна возвращать пользователя к `/conversations` или закрывать существующий inline detail, если именно так работает текущая архитектура.

Не создавай новый navigation flow без необходимости.

### Информация

Показать:

* subject;
* client name;
* conversation status.

Использовать только реальные значения.

Например:

```text
Иван Петров
Ремонт тормозной системы
OPEN
```

### Actions

Если существующая бизнес-логика поддерживает:

* Close conversation;
* Reopen conversation.

Использовать существующие API.

Не реализовывать новый механизм закрытия conversation.

---

# 6. ATTENTION / ESCALATION

Если для conversation существует активная escalation:

* показать визуальный attention indicator;
* показать escalation status;
* при наличии реальных данных показать причину/тип.

Используй уже существующий escalation API.

Не создавать новую escalation.

Если escalation отсутствует — не показывать fake alert.

---

# 7. MESSAGE THREAD

Основная область экрана — история сообщений.

Использовать существующие данные из:

```text
GET /api/conversations/:id
```

или существующего detail API/источника.

Не делать отдельный запрос на каждое сообщение.

---

## Сообщения должны различаться визуально

Если реальные данные позволяют определить sender:

### Customer

Отдельная визуальная подача.

### AI/Admin

Другая визуальная подача.

Например:

```text
CUSTOMER
Здравствуйте, можно записаться на замену масла?

                    AI
Здравствуйте! Конечно...
```

Но:

> Не определяй sender по догадке.

Если backend не предоставляет достоверного признака AI/Admin:

* не выдумывать;
* использовать нейтральное отображение;
* сохранить существующую семантику.

---

# 8. MESSAGE METADATA

Для каждого сообщения, если данные доступны:

* sender;
* timestamp;
* channel;
* delivery status.

Не перегружать интерфейс.

Основной приоритет:

1. текст;
2. кто отправил;
3. время;
4. статус доставки — если существует.

---

# 9. MESSAGE STATES

Обязательно обработать:

### Loading

Показывать skeleton/loading state.

### Empty

Если сообщений нет:

```text
No messages yet
```

или аналогичный текст в стиле приложения.

### Error

Если detail API не загрузился:

понятное сообщение об ошибке + существующий retry mechanism, если он уже используется.

Не создавать сложную новую систему ошибок.

---

# 10. COMPOSER

Существующий composer должен быть сохранён.

Он должен продолжать использовать существующий send flow.

Например:

```text
[ Type your message...                  ] [Send]
```

### КРИТИЧЕСКИ ВАЖНО

Не отправлять сообщения напрямую в Telegram API из frontend.

Frontend должен использовать существующий backend flow:

```text
Conversation
    ↓
existing message API
    ↓
Channel Delivery
    ↓
Telegram Adapter
    ↓
Telegram
```

Не обходить:

* `channelMessageService`;
* `channelDeliveryService`;
* существующий `/api/channels/:id/messages/:id/send`.

---

# 11. SEND STATES

Composer должен корректно обрабатывать:

* empty message;
* sending;
* sent;
* failed.

Во время отправки:

* disable Send;
* показать loading state.

При ошибке:

* показать понятную ошибку;
* не очищать сообщение, если существующая архитектура позволяет повторить отправку.

Не создавать новую delivery system.

---

# 12. CLOSED CONVERSATION

Если conversation имеет статус `CLOSED`:

использовать существующее бизнес-правило.

Если текущая backend-логика запрещает отправку:

* composer должен быть disabled;
* пользователю понятно объяснить причину.

Если reopen разрешён:

* показать существующий Reopen action.

Не менять backend behavior.

---

# 13. RIGHT CONTEXT PANEL

На desktop справа сделать context panel.

Приоритет информации:

### Customer

* name;
* phone/email — только если реально доступно;
* существующая customer information.

### Vehicle

Если связан с customer/request:

* make;
* model;
* year;
* plate/VIN — только если реально доступно и уже предусмотрено текущими API.

Не выполнять N+1 запросы.

---

### Request / Service

Если существует customer request:

показать:

* request type;
* requested service;
* status;

только реальные поля.

---

### Escalation

Если есть активная escalation:

* status;
* relevant information.

Если нет — компактный neutral state либо ничего.

---

### AI Status

Показывать только если существующие данные действительно позволяют определить AI state.

Например:

```text
AI handling
Active
```

Но не создавать новый AI status model.

---

# 14. N+1 REQUESTS — КРИТИЧЕСКОЕ ТРЕБОВАНИЕ

Не создавать архитектуру вида:

```text
load conversation
→ load customer
→ load vehicle
→ load request
→ load escalation
→ load AI state
→ load messages individually
```

если это приводит к множественным запросам на каждый элемент.

Сначала изучи существующие API и используй уже возвращаемые relations/data.

Если нужны дополнительные существующие endpoint calls:

* минимизировать количество запросов;
* выполнять независимые запросы параллельно;
* не делать запросы внутри `.map()`.

---

# 15. MOBILE

Mobile — это не просто уменьшенный desktop.

Для ширины телефона использовать single-column layout:

```text
Header
↓
Conversation info
↓
Messages
↓
Composer
↓
Context
```

Context panel должен перемещаться ниже сообщений.

Не делать постоянную правую колонку на мобильном.

---

## Mobile requirements

Обязательно:

* отсутствие horizontal overflow;
* сообщения не выходят за экран;
* composer не ломает layout;
* кнопки имеют удобную touch area;
* header не переполняется;
* длинные имена/subject корректно переносятся;
* context cards идут одной колонкой.

Не использовать горизонтальный скролл для основного Conversation Detail.

---

# 16. RESPONSIVE BREAKPOINTS

Использовать существующие Tailwind breakpoints проекта.

Не добавлять новую responsive framework.

Примерная логика:

```text
Desktop:
message thread + context panel

Tablet:
message thread + narrower context

Mobile:
single column
```

---

# 17. DESIGN SYSTEM

Использовать утверждённую визуальную систему проекта AI Администратор:

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

### Gold

Использовать умеренно:

* primary action;
* active state;
* attention highlight;
* selected state;
* важные actions;
* focus.

НЕ использовать gold:

* на всей панели;
* на всех cards;
* на всех icons;
* на всех borders;
* как большой декоративный фон.

---

# 18. ВИЗУАЛЬНЫЙ СТИЛЬ

Продукт:

**AI Администратор**

Визуальное направление:

**Dark Graphite + Premium Gold**

Характер:

* premium automotive technology;
* B2B SaaS;
* operational;
* professional;
* trustworthy;
* restrained;
* high contrast;
* clean.

Не использовать:

* cyberpunk;
* gaming UI;
* neon;
* excessive gradients;
* glassmorphism;
* excessive shadows;
* огромные декоративные элементы;
* yellow/black overload.

---

# 19. COMPONENT REUSE

Максимально использовать существующие:

* AppShell;
* Header;
* PageContainer;
* PageHeader;
* Badge;
* buttons;
* cards;
* inputs;
* existing conversation components;
* existing composer;
* existing API utilities.

Не создавать новые компоненты, если существующий компонент уже решает задачу.

Если новый компонент действительно необходим — сделать его небольшим и переиспользуемым.

---

# 20. ACCESSIBILITY

Обязательно:

* semantic buttons;
* accessible labels;
* keyboard navigation;
* visible focus;
* sufficient contrast;
* disabled states;
* textarea/button accessibility;
* не использовать только цвет для обозначения статуса.

Особенно важно:

Customer / AI / Admin messages должны различаться не только цветом.

---

# 21. DATA INTEGRITY

Нельзя:

* fake clients;
* fake messages;
* fake vehicle information;
* fake AI status;
* fake escalation;
* fake timestamps;
* hardcoded demo content.

Все данные должны приходить из существующей системы.

Если данных нет:

```text
No information available
```

или соответствующий empty state.

---

# 22. НЕ ТРОГАТЬ СУЩЕСТВУЮЩУЮ БИЗНЕС-ЛОГИКУ

Особенно:

* Telegram;
* ChannelConnection;
* ChannelAdapter;
* CustomerChannelIdentity;
* Conversation;
* Message;
* ChannelDelivery;
* escalation logic;
* authentication;
* AI behavior.

Prompt 22 — frontend-focused.

---

# 23. ПРОВЕРКА СУЩЕСТВУЮЩИХ API

Перед реализацией составь внутреннюю карту:

```text
Conversation Detail
    ↓
conversation detail API
    ↓
messages
    ↓
customer
    ↓
vehicle
    ↓
request
    ↓
escalation
    ↓
channel
    ↓
delivery
```

Используй только реально существующие endpoints и поля.

Если какое-либо поле отсутствует:

> НЕ добавляй backend ради красивого UI.

---

# 24. FILE SCOPE

Старайся ограничить изменения frontend-файлами, непосредственно связанными с Conversation Detail.

Не переписывай:

* backend;
* database;
* Telegram;
* unrelated settings pages;
* Dashboard;
* Conversations Inbox без необходимости;
* AppShell без необходимости.

Если необходимо изменить общий компонент для корректного responsive behavior — объясни это в Final Report.

---

# 25. VALIDATION

После реализации обязательно выполнить:

### TypeScript

```bash
npx tsc --noEmit
```

### Production build

```bash
npm run build
```

### Tests

Запустить существующий test suite.

Не менять тесты только ради того, чтобы они прошли.

Если добавляешь frontend tests только при наличии существующего test framework.

---

# 26. MANUAL CODE REVIEW

Перед завершением проверить:

### Desktop

* header;
* message thread;
* composer;
* context panel;
* close/reopen;
* escalation;
* loading/error/empty.

### Mobile

* single column;
* no horizontal overflow;
* message wrapping;
* composer;
* context below messages;
* buttons accessible.

### Data

* no fake data;
* no N+1;
* no duplicated API logic;
* no direct Telegram calls.

---

# 27. GIT

После успешной реализации:

```bash
git status
git diff
```

Убедись, что в commit попали только относящиеся к Prompt 22 изменения.

Создай commit:

```text
feat: build conversation detail v1
```

Не выполнять force push.

Если remote настроен:

```bash
git push
```

---

# 28. FINAL REPORT

После выполнения создай:

```text
docs/final-reports/final-report-22.md
```

Final Report должен содержать:

## 1. Summary

Что реализовано.

## 2. Files Changed

Список изменённых/созданных файлов.

## 3. Existing Architecture Reused

Какие существующие компоненты/API использованы.

## 4. Conversation Detail

Что сделано:

* header;
* messages;
* sender distinction;
* composer;
* status;
* escalation;
* context.

## 5. Responsive

Что сделано для:

* desktop;
* tablet;
* mobile.

## 6. Data Sources

Какие реальные API используются.

## 7. N+1 Review

Объяснить, как предотвращены лишние запросы.

## 8. Backend Changes

Явно указать:

```text
No backend changes.
```

если backend действительно не менялся.

## 9. Database

Указать:

```text
No Prisma schema changes.
No migrations.
```

если это действительно так.

## 10. AI Isolation

Подтвердить:

```text
No AI behavior changes.
```

если AI не изменялся.

## 11. Validation

Указать результаты:

* TypeScript;
* build;
* tests.

## 12. Git

Указать:

* commit hash;
* commit message;
* push status;
* clean/dirty working tree.

## 13. Limitations / Technical Debt

Честно перечислить ограничения.

Не скрывать архитектурные компромиссы.

---

# 29. КРИТИЧЕСКОЕ ПРАВИЛО

Не считай задачу выполненной только потому, что экран выглядит красиво.

Главные критерии:

1. существующая архитектура сохранена;
2. реальные данные используются корректно;
3. отправка сообщений идёт через существующий backend flow;
4. Telegram integration не обходится;
5. нет fake data;
6. нет N+1;
7. desktop и mobile работают;
8. backend не изменён;
9. TypeScript/build/tests проходят;
10. Final Report создан.

---

# RESULT

После выполнения должен существовать полноценный:

**Conversation Detail v1**

внутри существующего:

**AI Администратор**

с рабочей историей сообщений, существующей отправкой, контекстом клиента и responsive desktop/mobile UI.

Не создавай вторую архитектуру.

Улучши ту, которая уже существует.
