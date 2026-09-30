## Final Report — Prompt 49.1: Protect Conversation → CustomerRequest Link Invariant

**Итог: PASS (AC1–AC22).** Связь `Conversation.customerRequestId` теперь записывается только мостом «Создать обращение» из Prompt 49. Общий `PATCH /api/conversations/:id` не может её установить, заменить или удалить: запрос с полем `customerRequestId` отклоняется целиком (400 `VALIDATION_ERROR`, сообщение на русском). Проверка на сервере — в схеме валидации, в сервисе и на уровне типов репозитория.

- Без изменения схемы и без миграции; `.env` / `DATABASE_URL` / `DIRECT_URL` не менялись.
- Обычные PATCH (статус, тема, клиент) работают как прежде.
- Push не выполнялся, Prompt 50 не начинался.

### 1. Initial state
`master`, `HEAD` = `082fcc2` (Prompt 49), `origin/master` = `054398a`; ровно 1 коммит впереди, дерево чистое. **1402** теста.

### 2. Vulnerable write path found
Путь: `PATCH /api/conversations/:id` (`api/conversations/[id].ts`) → `updateConversationSchema` → `conversationService.updateConversation` → `conversationRepository.updateById`.

- `updateConversationSchema` принимал `customerRequestId` как необязательный UUID **или `null`**. Существующий тест даже закреплял это: «allows clearing customerId/customerRequestId to null».
- `updateConversation` передавал значение в запись без условий: `...(input.customerRequestId !== undefined ? { customerRequestId } : {})`.
- Проверялось только, что обращение принадлежит тенанту и совпадает по клиенту. Поэтому любой owner/admin/manager мог:
  - привязать к диалогу любое своё обращение в обход моста;
  - заменить уже созданную мостом связь;
  - отвязать её (`null`).
- `updateById` принимал любые скалярные поля, включая `customerRequestId`.

UI этим путём не пользуется: карточка диалога отправляет только `{ status }`. Мост Prompt 49 публичный PATCH **не** вызывает — он пишет через репозиторий внутри своей транзакции. Стоп-условий нет.

### 3. Repository-wide `customerRequestId` write audit
| Место записи | Модель | Класс | Решение |
|---|---|---|---|
| `conversationService.updateConversation` (PATCH диалога) | Conversation | **B** — общая, управляется пользователем | **Закрыто** |
| `conversationRequestService.createCustomerRequestFromConversation` (мост Prompt 49) | Conversation | **A** — легитимная запись моста | Оставлено; теперь через отдельный `linkCustomerRequest` |
| `conversationService.createConversation` (`POST /api/conversations`, поле «Заявка клиента (опционально)» в форме создания в Настройках) | Conversation | B — только при создании, с проверкой тенанта и клиента | Не менялось: это документированный существующий сценарий, а задача касается PATCH (см. §16) |
| `channelInboundRepository` (входящие Telegram), `messageRepository` (`lastMessageAt`) | Conversation | — | `customerRequestId` не пишут |
| AI (`contextBuilder`, инструменты) | Conversation | — | Только чтение |
| `serviceFollowUpService` (мост follow-up → обращение, Prompt 48.1) | ServiceFollowUp | D — другой жизненный цикл | Не затронуто |
| `customerRequestRepository` (история статусов) | CustomerRequestStatusHistory | D | Не затронуто |
| `tests/*` (фикстуры, моки) | — | C | Обновлены под новый путь записи (§8) |

### 4. Fix implemented
Три уровня, без новых слоёв и абстракций:

1. **Валидация** (`conversation.schemas.ts`). В `updateConversationSchema` поле `customerRequestId` объявлено как `z.undefined(...)`: любое присланное значение (UUID, `null`, `""`, мусор) даёт ошибку поля «Связь диалога с обращением нельзя изменить или удалить».
   - Выбран явный отказ, а не молчаливое отбрасывание, как в `channel.schemas` / `team.schemas`. Иначе `{ status: "CLOSED", customerRequestId: null }` вернул бы 200, и клиент решил бы, что связь удалена, хотя она осталась.
2. **Сервис** (`conversationService.updateConversation`). `customerRequestId` больше не читается из входных данных и не попадает в запись. Существующая связь по-прежнему используется, чтобы проверить согласованность при смене клиента.
3. **Репозиторий** (`conversationRepository`).
   - Тип `updateById` исключает `customerRequestId`: общий путь записи не компилируется с этим полем.
   - Новый `linkCustomerRequest(tenantId, businessId, id, { customerRequestId, customerId? }, tx)` — единственная запись связи. Это `updateMany … WHERE tenantId AND businessId AND id AND customerRequestId IS NULL`: связь можно поставить, но заменить существующую нельзя даже внутренним кодом.
   - Мост вызывает его вместо `updateById`.

### 5. Public PATCH behavior after fix
| Запрос | Ответ | Запись в БД |
|---|---|---|
| `{ customerRequestId: "<uuid>" }` — привязать или заменить | 400 `VALIDATION_ERROR`, `details.customerRequestId = ["Связь диалога с обращением нельзя изменить или удалить"]` | нет |
| `{ customerRequestId: null }` / `""` — отвязать | то же 400 | нет |
| `{ status: "CLOSED", customerRequestId: null }` — смешанный запрос | то же 400, статус **не** применяется частично | нет |
| `{ status }`, `{ subject }`, `{ closedAt }`, `{ customerId }` | как прежде (200, те же правила жизненного цикла) | связь не трогается |

Верхнеуровневое `message: "Invalid request data"` — общий формат ошибок API, он не менялся. Русский текст приходит в `details` поля.

### 6. Internal Prompt 49 bridge behavior
Логика не менялась:
- снимок диалога;
- валидация вне транзакции;
- транзакция с `SELECT … FOR UPDATE`;
- повторная проверка;
- создание обращения с историей;
- привязка.

Изменён только вызов записи: `updateById` → `linkCustomerRequest`, с теми же данными (`customerRequestId` и `customerId`, если его не было). Под блокировкой строка всегда ещё не привязана, поэтому условие `IS NULL` ничего не меняет в обычном сценарии и служит дополнительной защитой. Идемпотентность (`created: false` с тем же обращением) и конкурентность (10 параллельных вызовов → 1 обращение) подтверждены теми же тестами Prompt 49; их проверки не ослаблялись.

### 7. Tenant isolation
- Поле отклоняется **до** обращения к базе, одинаково для своего, чужого и несуществующего id: ответы побайтно совпадают. Узнать, существует ли чужое обращение, нельзя. Раньше PATCH искал обращение и отвечал 404 или 400 в зависимости от результата, так что через него можно было проверять id (только в пределах своего тенанта).
- Чужой тенант на PATCH со статусом получает 404, как и раньше. Попытки перепривязать или отвязать отклоняются валидацией, диалог не меняется.
- `linkCustomerRequest` ограничен `tenantId + businessId + id`. Тест в `tenantIsolation.test.ts` проверяет точный `where`, включая `customerRequestId: null`.

### 8. Tests before/after
**1402 → 1420** (+18), 69 файлов, все PASS.

- Новый `tests/conversationRequestLinkProtection.test.ts` (12 тестов) вызывает настоящие HTTP-обработчики `PATCH /api/conversations/:id` и `POST /api/conversations/:id/request` с настоящими схемами и сервисами. Все записи в диалоги журналируются. Проверяется:
  - привязать нельзя;
  - заменить нельзя;
  - очистить `null` / `""` нельзя;
  - смешанный запрос не применяется частично;
  - закрыть, переоткрыть и сменить тему можно, связь сохраняется;
  - мост после отклонённого PATCH создаёт и привязывает ровно одно обращение, повтор возвращает то же;
  - мост на уже привязанном диалоге ничего не пишет;
  - чужой, свой и несуществующий id дают одинаковый ответ;
  - чужой тенант получает 400/400/404, данные не меняются;
  - мост чужого тенанта → 404.
- `conversation.schemas.test.ts`: тест «можно очистить customerRequestId» заменён тестом «можно очистить customerId». Добавлено 5 отказов (UUID, `null`, `""`, мусор, поле без других полей).
- `conversationService.test.ts`: +1 — даже невалидированный ввод с `customerRequestId` не доходит до записи.
- `conversationRequestBridge.test.ts`: мок записи переименован в `linkCustomerRequest` и повторяет условие `IS NULL`. Все 32 теста и их проверки без изменений.
- `tenantIsolation.test.ts`: тест записи связи переведён на `linkCustomerRequest` (тот же счёт).
- Контрольный прогон новых тестов на коде **до** исправления: 13 падений. На исправленном коде: 0.

### 9. Typecheck
`npm run typecheck` — **PASS**.

### 10. Build
`npm run build` — **PASS** (прежнее предупреждение Vite о размере чанка).

### 11. Prisma validation/migration status
- `npx prisma validate` — схема валидна.
- `npx prisma migrate status` — 15 миграций, «Database schema is up to date!».
- Количество миграций не изменилось (0 новых). `schema.prisma` не менялся. reset / force-reset / DROP / TRUNCATE не выполнялись.

### 12. Supabase validation
HTTP-запросы шли к dev-серверу на основной Supabase, в существующем тестовом тенанте `p48-1-check4`; чужой тенант — `p48-1-check3`. Новых тенантов нет.

Перед любой записью скрипт убедился, что сервер уже работает с кодом 49.1. Для этого он отправил PATCH на несуществующий id: код 49.1 отвечает 400, старый ответил бы 404. Иначе проверка A могла бы реально перепривязать данные.

**14 / 14 PASS:**
- **A.** PATCH с другим обращением на связанном диалоге Prompt 49 («Проверка P49 — стук в подвеске») → 400, связь прежняя.
- **B.** `null`, `""` и смешанный `{ status, customerRequestId: null }` → 400. Связь и статус не изменились.
- **C.** Закрыть и переоткрыть через PATCH → 200 / 200, связь сохранена, исходный статус восстановлен.
- **D.** Мост на связанном диалоге → 200, `created: false`, то же обращение.
- **Новый диалог «Проверка P49.1 — защита связи»:**
  - PATCH-привязка → 400, диалог не привязан;
  - мост → 201, повтор → 200 с тем же обращением;
  - после этого очистить связь PATCH-запросом нельзя.
- **Тенанты:** чужие перепривязка и отвязка → 400, ответ идентичен ответу на случайный id; чужой PATCH статуса → 404; диалог не изменён.

Supabase MCP в этой сессии не авторизован. Поэтому контрольные замеры данных делались только чтением, через Prisma-клиент проекта с тем же `DATABASE_URL`.

### 13. Browser regression
Headless Chromium, 1440 px, вход через UI — **5 / 5 PASS:**
1. Диалог Prompt 49 открывается.
2. Блок «Обращение создано» показывает статус, автомобиль, услугу и дату.
3. «Открыть обращение» ведёт к этому обращению («Источник: Диалог»).
4. Кнопка «Закрыть» → «Открыть заново» работает (существующий PATCH статуса). Статус возвращён, связь цела.
5. Ошибок в консоли и неуспешных `/api`-запросов со страниц нет.

UI не менялся.

### 14. Files changed
| Файл | Изменение |
|---|---|
| `src/server/validation/conversation.schemas.ts` | `customerRequestId` в PATCH-схеме отклоняется; русское сообщение |
| `src/server/services/conversationService.ts` | PATCH никогда не пишет `customerRequestId` |
| `src/server/repositories/conversationRepository.ts` | `updateById` без `customerRequestId`; новый `linkCustomerRequest` (условная запись) |
| `src/server/services/conversationRequestService.ts` | мост пишет связь через `linkCustomerRequest` |
| `tests/conversationRequestLinkProtection.test.ts` | новый: 12 тестов |
| `tests/conversation.schemas.test.ts` | +5 тестов, один устаревший переписан |
| `tests/conversationService.test.ts` | +1 тест |
| `tests/conversationRequestBridge.test.ts` | мок записи → `linkCustomerRequest` |
| `tests/tenantIsolation.test.ts` | тест записи связи → `linkCustomerRequest` |
| `docs/prompts/prompt-49-1.md`, `docs/final-reports/final-report-49-1.md` | документация |

### 15. Existing-data safety
Замер только чтением до и после проверки:
- тенанты без тестовых: tenants 3, businesses 3, users 3, customers 1, vehicles 1, services 3, appointments 1, service_records 1, customer_requests 2, conversations 3;
- md5-отпечаток пар `диалог:связь` реальных тенантов.

После проверки все значения **идентичны**. Реальные связанные диалоги остались связанными. Изменения есть только в тестовом тенанте: +1 диалог «Проверка P49.1» и +1 обращение, созданное мостом (связанных диалогов 10 → 11, обращений 14 → 15). Статус использованного диалога Prompt 49 возвращён в исходный.

### 16. Remaining limitations
1. **Создание диалога со связью.** `POST /api/conversations` по-прежнему принимает `customerRequestId` (форма создания в Настройках, «Заявка клиента (опционально)»). Это существующий документированный сценарий, с проверкой тенанта и клиента, и он не может заменить или удалить связь. Если связь должна ставиться *только* мостом, это отдельное продуктовое решение: оно затрагивает форму в UI.
2. **Смена клиента у связанного диалога.** PATCH `customerId` по-прежнему проверяет совпадение с клиентом обращения. Но `customerId: null` у связанного диалога допускается, как и раньше; эта задача его не трогала.
3. **Английское `message: "Invalid request data"`** на верхнем уровне ошибки валидации — общий формат API. Русский текст приходит в `details.customerRequestId`; UI этот путь не вызывает.
4. **Тестовые данные** «Проверка P49 / P49.1» остаются в тестовом тенанте.

### 17. Git state
Один новый локальный коммит `fix: protect conversation request linkage` поверх `082fcc2`. Коммит Prompt 49 не изменён (amend не делался); `master` ровно на 2 коммита впереди `origin/master` (`054398a`). Hash указан в ответе в чате.

### 18. Push status
**Push не выполнялся.** origin, main и настройки GitHub не менялись.

### 19. LOCAL APP URL
`http://localhost:5173` — dev-сервер на основной Supabase, `.env` не менялся. Тестовый вход: `p48-1-check4@example.com`.
