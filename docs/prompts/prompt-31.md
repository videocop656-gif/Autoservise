# Prompt 31 — Operational Flow UX Hardening

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

=== PROMPT 31 — OPERATIONAL FLOW UX HARDENING ===

ROLE

Ты — senior full-stack engineer, работающий внутри существующего проекта Autoservise.

Работай ТОЛЬКО с уже существующей архитектурой и кодом проекта.

ЦЕЛЬ

Улучшить существующий operational flow между:

Conversation → Request → Appointment

и закрыть подтверждённые P1 UX gaps из предыдущего аудита.

ВАЖНО:

Это НЕ новый большой доменный этап.

НЕ создавать WorkOrder.
НЕ создавать Invoice.
НЕ создавать Payment.
НЕ создавать Inventory.
НЕ создавать Technician.
НЕ создавать новые Prisma-модели без абсолютной необходимости.
НЕ менять существующую архитектуру ради удобства реализации.

Основная задача — сделать уже существующие Conversation, Request и Appointment связанными и удобными для оператора.

--------------------------------------------------
1. ОБЯЗАТЕЛЬНО СНАЧАЛА ИЗУЧИ ТЕКУЩИЙ КОД
--------------------------------------------------

Перед изменениями:

1. Найди текущие реализации:

- /conversations
- ConversationDetailPanel
- /requests
- Request Detail
- /appointments
- существующие appointment API/routes
- существующие request API/routes
- существующие conversation API/routes
- текущие Prisma relations/models
- текущие frontend types
- существующие tests

2. Определи:

- какие связи Conversation ↔ Request уже существуют;
- какие связи Request ↔ Appointment уже существуют;
- какие API endpoints уже существуют;
- какие UI actions уже существуют;
- какие reusable components можно использовать.

3. НЕ дублируй существующую логику.

Если необходимая связь или endpoint уже существует — используй его.

--------------------------------------------------
2. CONVERSATION → REQUEST
--------------------------------------------------

В Conversation Detail добавь удобный способ перейти к связанному Request, ЕСЛИ такой Request уже существует.

Требования:

- использовать существующую связь;
- не создавать дубликаты Request;
- показывать понятный статус Request;
- действие должно вести на существующий Request Detail;
- использовать существующий routing/navigation pattern проекта.

Если у Conversation нет Request:

- НЕ создавать Request автоматически;
- НЕ менять поведение AI;
- можно показать нейтральное действие/состояние "No request linked", только если это соответствует существующему UI pattern.

Не создавать новую сущность.

--------------------------------------------------
3. REQUEST → CONVERSATION
--------------------------------------------------

В Request Detail:

если Request связан с Conversation:

- показать ссылку/shortcut на Conversation;
- пользователь должен иметь возможность открыть Conversation Detail;
- сохранить текущий Request Detail state настолько, насколько это позволяет существующий routing.

Не создавать новую связь, если она уже существует.

Не создавать дубликаты.

--------------------------------------------------
4. REQUEST → APPOINTMENT
--------------------------------------------------

В Request Detail добавить явное действие:

"Create Appointment"

или существующий термин проекта, если он уже определён.

При нажатии:

- использовать существующий Appointment creation flow/API;
- НЕ создавать новый endpoint, если подходящий endpoint уже существует;
- Request должен быть связан с созданным Appointment;
- после успешного создания UI должен явно показать эту связь;
- Request не должен оставаться визуально "без Appointment".

Если Request уже имеет Appointment:

- вместо "Create Appointment" показать существующий Appointment;
- дать возможность перейти к Appointment Detail/существующему appointment view;
- НЕ создавать второй Appointment автоматически.

--------------------------------------------------
5. REQUEST STATUS / APPOINTMENT CONSISTENCY
--------------------------------------------------

Не менять существующую бизнес-логику статусов без необходимости.

Существующие Request statuses:

NEW
IN_PROGRESS
WAITING_CUSTOMER
QUALIFIED
CONVERTED
CLOSED
CANCELLED

Сохрани их.

Если существующая логика проекта уже предусматривает переход Request в CONVERTED после создания/подтверждения Appointment — используй её.

Если такой автоматизации НЕТ:

НЕ придумывай новую бизнес-логику только ради Prompt 31.

Зафиксируй это в отчёте как существующий gap.

Главное — не сломать текущий lifecycle.

--------------------------------------------------
6. APPOINTMENT CONTEXT
--------------------------------------------------

Если Appointment уже связан с Request:

в Appointment UI используй существующий механизм отображения контекста.

Минимально желательно показать:

- связанный Request;
- клиента;
- автомобиль, если связь уже доступна;
- возможность вернуться в Request Detail.

НЕ создавать отдельную Appointment Detail domain model.

НЕ добавлять WorkOrder.

--------------------------------------------------
7. URL / NAVIGATION
--------------------------------------------------

Используй существующий routing подход проекта.

Не вводи новый routing library.

Не ломай существующие URLs.

Проверь:

/conversations
/requests
/appointments

Если приложение использует query parameters для detail state — следуй существующему pattern.

НЕ делай масштабный cross-cutting refactor URL persistence в этом prompt.

Это отдельный будущий P1 task.

--------------------------------------------------
8. UX REQUIREMENTS
--------------------------------------------------

Все новые действия должны быть:

- очевидными;
- небольшими;
- согласованными с существующим UI;
- без визуального шума;
- без новых крупных компонентов, если существующие компоненты можно переиспользовать.

Используй существующие:

buttons
badges
cards
dialogs
links
icons
empty states

Не вводи новую дизайн-систему.

Не меняй глобальную цветовую палитру.

Не меняй sidebar.

Не меняй dashboard.

Не меняй общий App Shell.

--------------------------------------------------
9. TENANT ISOLATION — CRITICAL
--------------------------------------------------

Любая новая или изменённая server-side логика ОБЯЗАНА сохранять tenant isolation.

Нельзя:

- получать Request только по ID без проверки tenant;
- получать Conversation только по ID без tenant scope;
- получать Appointment только по ID без tenant scope;
- позволять связать сущности разных tenants;
- доверять tenantId из client request body, если tenantId должен определяться сервером.

Используй существующий server-side tenant context/pattern.

Добавь regression tests, если изменяется server-side relation logic.

--------------------------------------------------
10. DUPLICATE / IDEMPOTENCY SAFETY
--------------------------------------------------

Не пытайся в этом prompt реализовать общую API idempotency систему.

Но UI должен предотвращать очевидное повторное создание Appointment:

- disable action during request;
- prevent double-submit;
- после успешного создания обновить состояние;
- повторное открытие Request Detail не должно предлагать создать второй Appointment, если существующий уже найден.

--------------------------------------------------
11. ERROR HANDLING
--------------------------------------------------

При ошибке создания Appointment:

- показать существующий error UI pattern;
- не показывать ложный success;
- не изменять Request state локально так, будто Appointment создан;
- позволить пользователю повторить действие.

Не использовать alert(), если проект уже имеет toast/dialog/error system.

--------------------------------------------------
12. LOADING STATES
--------------------------------------------------

Все новые async actions должны иметь нормальное loading состояние.

Минимально:

- Create Appointment → loading;
- после успеха → обновление данных;
- после ошибки → recoverable error.

Не допускать double-submit.

--------------------------------------------------
13. TESTS
--------------------------------------------------

После реализации обязательно:

1. TypeScript
2. Build
3. полный существующий test suite

Цель:

1221/1221 или больше, если добавлены новые тесты.

Добавь regression tests для новых критичных сценариев.

Минимальные сценарии:

A. Request without Appointment
→ Create Appointment
→ Appointment created
→ Request показывает Appointment

B. Request with Appointment
→ Create Appointment action отсутствует
→ existing Appointment доступен

C. Conversation with linked Request
→ открытие Request работает

D. Request with linked Conversation
→ открытие Conversation работает

E. Tenant A
→ не может получить/изменить Request/Appointment/Conversation Tenant B

F. Double-submit Create Appointment
→ не создаётся очевидный duplicate через UI flow

--------------------------------------------------
14. НЕ ДЕЛАТЬ
--------------------------------------------------

В рамках Prompt 31 НЕ делать:

- WorkOrder
- Invoice
- Payment
- Inventory
- Technician
- ServiceRecord как новую Prisma model
- AI
- LLM
- Telegram changes
- WhatsApp
- Avito
- VK
- MAX
- CRM integration
- Calendar integration
- SMS
- Billing
- subscriptions
- redesign
- новый App Shell
- новую дизайн-систему
- масштабный refactor Prisma schema
- URL persistence для всех detail screens
- date-range filter для Appointments
- today's appointments в Operations

--------------------------------------------------
15. DOCUMENTATION
--------------------------------------------------

После реализации создай/обнови соответствующий final report в:

docs/final-reports/

Отчёт должен содержать:

1. Что изменено
2. Какие существующие endpoints/components использованы
3. Какие новые endpoints созданы — если вообще созданы
4. Какие модели Prisma изменены — если вообще изменены
5. Conversation ↔ Request behavior
6. Request ↔ Appointment behavior
7. Tenant isolation
8. Tests
9. TypeScript
10. Build
11. Git commit hash
12. Remaining product gaps

--------------------------------------------------
16. STOP CONDITION
--------------------------------------------------

После завершения:

Если:

TypeScript PASS
Build PASS
Tests PASS

остановись.

НЕ переходи автоматически к следующему feature.

НЕ начинай WorkOrder.

НЕ начинай Invoice.

НЕ начинай Payment.

НЕ начинай Inventory.

НЕ создавай новые Prisma models сверх необходимого для этой задачи.

Сформируй финальный отчёт.

--------------------------------------------------
17. FINAL REPORT FORMAT
--------------------------------------------------

Используй формат:

## Final Report — Prompt 31: Operational Flow UX Hardening

### Validation

TypeScript: PASS/FAIL
Build: PASS/FAIL
Tests: X/X passed

### Implemented

- ...
- ...
- ...

### Conversation ↔ Request

- ...

### Request ↔ Appointment

- ...

### Tenant Isolation

- ...

### API / Prisma Changes

- ...

### Tests Added

- ...

### Product Gaps Remaining

- ...

### Git

Commit:
Message:
Pushed: yes/no

### Screenshot Validation

Performed / Not performed

STOP.
