## Final Report — MCR-2: Missed Call Intake Foundation

AUTOSERVISE теперь надёжно понимает, что произошёл звонок:
- какой бизнес его получил (только по вызываемому номеру);
- кто звонил (нормализация MCR-1);
- отвечен он или пропущен (монотонная машина состояний);
- обработано ли уже это событие (идемпотентность на уровне БД);
- известен ли звонящий как клиент;
- готов ли пропущенный звонок к будущему восстановлению (`READY`).

Клиенту и владельцу **ничего не отправляется**: нет сообщений, доставок,
диалогов, AI, заявок и записей. Реального провайдера нет, есть только mock.

---

### 1. Baseline

- `master` = `origin/master` = `6e7493a` (`feat: add canonical phone identity foundation`), дерево чистое.
- 1730 / 1730 тестов, миграции применены.
- Расхождений с ожидаемым состоянием нет.
- Модели AuditLog в проекте нет; есть только `AiLog`, предназначенный для
  AI-событий (см. §17).

### 2. Schema changes

Одна новая миграция `20261003120000_missed_call_intake_foundation`, только
добавление. DDL сгенерирован `prisma migrate diff` против живой схемы (чтение)
плюс два CHECK-ограничения. Миграции MCR-1 не трогались.

- **Enum'ы:**
  - `CallDirection` (INBOUND / OUTBOUND);
  - `CallOutcome` (IN_PROGRESS / MISSED / ANSWERED);
  - `CallRecoveryState` (PENDING / NOT_ELIGIBLE / READY);
  - `CallEventType` (RINGING / ANSWERED / COMPLETED / MISSED).
- **`business_phone_numbers`:**
  - уникальный `activePhoneE164`;
  - индекс `(tenantId, businessId)`;
  - CHECK формата E.164;
  - CHECK «`activePhoneE164` = `phoneE164` при `isActive`, иначе NULL».
- **`call_interactions`:**
  - уникальная пара `(provider, providerCallId)`;
  - индексы: по тенанту и дате, по тенанту и `recoveryState`, по тенанту +
    номеру звонящего + `outcomeDetectedAt` (будущее анти-спам окно), по
    `customerId`.
- **`call_events`:**
  - уникальная пара `(provider, providerEventId)`;
  - индексы по звонку + времени получения и по тенанту.
- **Связи:**
  - Tenant / Business → Cascade (как везде);
  - номер бизнеса и клиент у звонка → Restrict (история звонков переживает
    деактивацию);
  - события → Cascade от звонка.

### 3. BusinessPhoneNumber design

Отдельная сущность; `Business.phone` остаётся текстом для отображения.

- **Поля:** `tenantId`, `businessId`, `phoneE164` (каноника MCR-1 в регионе
  бизнеса), `label`, `isActive`, `activePhoneE164`, `createdAt`, `updatedAt`.
- **API** (минимальное, по конвенциям `api/business/*`):
  - `GET /api/business/phone-numbers` — любая роль;
  - `POST { phone, label? }` — owner/admin;
  - `PATCH /api/business/phone-numbers/:id { isActive }` — owner/admin.
- **Удаления нет:** на номер ссылается история звонков.
- **Сообщения API:** невалидный номер → 400 `INVALID_PHONE`; номер уже
  активен где-либо → 409 `PHONE_NUMBER_IN_USE`. Кто держит номер, не
  сообщается.
- Портирования и подключения у провайдера нет.

### 4. Routing invariant

- **Не более одного АКТИВНОГО владельца номера во всех тенантах.**
  Обеспечивает БД: `activePhoneE164 @unique` по технике nullable-колонки, как
  `AiEscalation.activeConversationId`; синхронность с `isActive` закреплена
  CHECK. Неактивных строк с тем же номером может быть сколько угодно.
  Деактивация освобождает номер; повторная активация, если номер занят, → 409.
- **Маршрутизация** — только по номеру со стороны бизнеса (вызываемому для
  входящего звонка): нормализация **без региона** (нужен международный формат),
  затем поиск единственного активного номера, затем `tenantId + businessId`.
  - Номер не найден, неактивен, в национальном формате или бизнес не
    совпадает → `UNROUTABLE_NUMBER`, ничего не записывается.
  - Номер звонящего тенант **никогда** не выбирает.
  - `tenantId`/`businessId` из payload отбрасываются адаптером; в
    нормализованном событии таких полей нет вообще.
  - Звонок с уже существующим `providerCallId`, пришедший на другой бизнес, →
    `CALL_ROUTING_CONFLICT`; ничего не меняется и не переносится.
- **Проверено на живой БД:** попытка создать второго активного владельца из
  другого тенанта → P2002; рассинхрон `isActive`/`activePhoneE164` → CHECK.

### 5. TelephonyAdapter contract

`src/server/telephony/types.ts`:
- `TelephonyAdapter { provider; verify(request) → { ok }; parse(body) → NormalizedCallEvent }`.
- `verify` вызывается до разбора и до любого обращения к БД.
- `parse` — чистая функция, бросает `TelephonyPayloadError`.
- `NormalizedCallEvent` = `provider`, `providerEventId`, `providerCallId`,
  `eventType`, `direction`, `callerPhone` (null — скрыт), `calledPhone`,
  `occurredAt` (null, если провайдер не дал время), `wasAnswered` (только для
  COMPLETED, иначе null).
- Ядро (`callIntakeService`) провайдерский JSON не видит. Сырой payload **не
  хранится**: это PII, объём и отсутствие причины для отладки; хранятся только
  нормализованные поля.

### 6. Mock provider behavior

`mockTelephonyAdapter` — собственный «провайдерский» формат:

```
{ eventId, callId, event: "call.ringing" | "call.answered" | "call.completed" | "call.missed",
  direction: "inbound" | "outbound", from, to, timestamp?, answered? }
```

- **Скрытый номер:** `from` = `anonymous` / `private` / `unknown` /
  `restricted` / `unavailable` / `hidden` / пусто / null → `callerPhone = null`.
- **Лишние поля** отбрасываются.
- **Не бэкдор:** работает **только** если задан `TELEPHONY_MOCK_WEBHOOK_SECRET`,
  **никогда в production**, и только с этим секретом в заголовке
  `X-Mock-Telephony-Secret` (сравнение за постоянное время). Без секрета
  отклоняется любой запрос. `.env` не менялся: для живой проверки секрет
  сгенерирован случайно и передан процессу dev-сервера через окружение.
- **Имитирует все сценарии промпта:** звонок, ответ, завершение, пропуск,
  дубли, повторы, порядок, неизвестный номер, невалидный звонящий, повторные
  звонки.

### 7. CallInteraction design

Одна запись на реальный звонок (уникальная пара `provider + providerCallId`),
а не на событие вебхука:

- **Идентичность:** `tenantId`, `businessId`, `businessPhoneNumberId`,
  `provider`, `providerCallId`.
- **Звонящий:**
  - `remotePhoneE164` — внешняя сторона (звонящий для INBOUND); название
    выбрано честнее, чем callerPhoneE164, потому что для OUTBOUND это
    вызываемый;
  - `customerId` (nullable).
- **Состояние:** `direction`, `outcome`, `startedAt`, `answeredAt`, `endedAt`
  (время провайдера).
- **Время получения:** `firstEventReceivedAt`, `lastEventReceivedAt`,
  `outcomeDetectedAt`.
- **Восстановление:** `recoveryState`, `recoveryIneligibleReason`.
- **Аудит:** `createdAt`, `updatedAt`.

Лишних полей нет: состояний захвата и отправки (CLAIMED / SENT) **нет**, их
честно добавит MCR-4. Диалог при пропущенном звонке не создаётся; канальный
диалог появится, когда будет выбран канал.

### 8. Call state machine

`src/server/telephony/callStateMachine.ts` — чистая функция. Ранг исхода:
**IN_PROGRESS < MISSED < ANSWERED**; новый исход — максимум из текущего и
«свидетельства» события.

| Событие | Свидетельство |
|---|---|
| RINGING | — (только время начала) |
| ANSWERED | ANSWERED |
| COMPLETED `answered=true` | ANSWERED |
| COMPLETED `answered=false` | MISSED |
| COMPLETED без флага | — (только время окончания) |
| MISSED | MISSED |

- **Ответ — самый сильный факт:** отвеченный звонок никогда не становится
  пропущенным.
- **Поздний `ringing`** не «переоткрывает» звонок.
- **Поздний `answered` после `missed`** исправляет звонок на ANSWERED (если на
  звонок ответили, он не был пропущен) и выводит его из восстановления.
- **Время:** начало — самое раннее из сообщённых, ответ — самое раннее,
  окончание — первое сообщённое. Время получения за время провайдера не
  выдаётся.
- **Независимость от порядка доказана тестом:** все перестановки 6 наборов
  событий дают один исход.

### 9. Provider-event idempotency

- **Звонок:** `INSERT … ON CONFLICT DO NOTHING` (`createMany skipDuplicates`)
  по `(provider, providerCallId)`, затем `SELECT … FOR UPDATE` строки звонка.
- **Событие:** `INSERT … ON CONFLICT DO NOTHING` по `(provider, providerEventId)`.
  Если вставлено 0 строк, это повтор: возвращается `duplicate`, состояние не
  меняется (даже `lastEventReceivedAt`).
- Вставки не падают на конфликте, поэтому транзакция Postgres не прерывается.
  Проверки «прочитал — вставил» в памяти нет: гарантия держится на уникальных
  ключах БД.

### 10. Concurrency behavior

Одна короткая транзакция на событие: вставка, если нет, → блокировка строки →
вставка события → переход состояния. Конкурентные события одного звонка
выстраиваются в очередь на блокировке строки и применяются по одному; гонку
вставок разрешают уникальные ключи.

- **Живая проверка на Supabase:** 6 одинаковых и 2 разных события одного
  звонка одновременно → 1 звонок, 3 события, 5 `duplicate`, итог MISSED, ни
  одного 5xx.
- **В памяти:** 5 одинаковых и 2 разных одновременно → то же самое.

### 11. Out-of-order behavior

Проверено тестами и вживую:

| Сценарий | Итог |
|---|---|
| A: ringing → missed | MISSED / READY |
| B: ringing → answered → completed | ANSWERED / NOT_ELIGIBLE |
| C: missed → поздний ringing | остаётся MISSED |
| D: completed(answered) → поздний answered | остаётся ANSWERED |
| E: дубль missed | одно применение, `duplicate` |
| F: конкурентные события | корректно |
| answered → поздние missed / completed(false) / ringing | остаётся ANSWERED |

### 12. Caller normalization

- Используется `normalizePhone` из MCR-1 в регионе **маршрутизированного**
  бизнеса; второго парсера нет.
- **Скрытый, анонимный, невалидный или недоступный номер:** звонок
  сохраняется с `remotePhoneE164 = null`; поиск клиента не выполняется, клиент
  не создаётся; `NOT_ELIGIBLE` с причиной `NO_CALLER_PHONE`.
- **Номер бизнеса** нормализуется без региона: провайдер обязан присылать
  международный формат (MCR-8 приводит к нему в адаптере).

### 13. Customer resolution

- `customerRepository.findActiveByPhoneE164(tenantId, businessId, e164)` из
  MCR-1 вызывается **после** маршрутизации.
- **Ровно одно** активное совпадение → `customerId`. Ноль или несколько →
  `null`. Без создания, без слияния, без выхода за тенант.
- Привязка ставится при создании записи звонка (первом событии).
- **Звонок неизвестного** сохраняется и считается `READY`.

### 14. Recovery eligibility

`READY` выставляется только при одновременном выполнении условий:
- звонок INBOUND;
- итог MISSED;
- есть валидный номер звонящего;
- звонок прошёл маршрутизацию через активный номер — иначе записи нет вовсе.

Остальные состояния:

| Состояние | Когда |
|---|---|
| `PENDING` | итог ещё неизвестен |
| `NOT_ELIGIBLE` + `ANSWERED` | звонок отвечен |
| `NOT_ELIGIBLE` + `OUTBOUND` | исходящий звонок |
| `NOT_ELIGIBLE` + `NO_CALLER_PHONE` | номер скрыт или невалиден |

Специфики WhatsApp здесь нет: доступность канала решает будущий
маршрутизатор.

**Анти-спам:** повторные звонки **не** схлопываются — 3 звонка дают 3 записи
`READY`. MCR-4 применит окно по ключу `(tenantId, businessId, remotePhoneE164)`
и `outcomeDetectedAt` (под это есть индекс): например, «не более одного
восстановления на номер в бизнесе за N минут».

### 15. Latency timestamps

| Поле | Источник | Смысл |
|---|---|---|
| `startedAt` / `answeredAt` / `endedAt` | провайдер | время звонка; NULL, если провайдер не сообщил |
| `firstEventReceivedAt` / `lastEventReceivedAt` | AUTOSERVISE | когда события дошли до нас |
| `outcomeDetectedAt` | AUTOSERVISE | когда текущий итог впервые стал известен; для пропущенного это «пропущенный звонок обнаружен» — начало будущей задержки «обнаружен → сообщение отправлено» |
| `call_events.occurredAt` / `receivedAt` | оба | по каждому событию — для анализа задержки вебхуков провайдера |

### 16. Webhook security

`POST /api/webhooks/telephony/mock`:
1. Аутентификация провайдера до разбора и до любого обращения к БД.
2. Разбор.
3. Маршрутизация по номеру.

| Ответ | Когда |
|---|---|
| 200 `{ ok, status: "accepted" \| "duplicate" }` | принято; повторы тоже 200, чтобы провайдер прекратил ретраи |
| 401 `UNAUTHORIZED` | неверный или отсутствующий секрет, mock выключен |
| 400 `INVALID_PAYLOAD` | невалидное событие |
| 422 `UNROUTABLE_NUMBER` | номер не найден; ничего не записано |
| 409 `CALL_ROUTING_CONFLICT` | звонок принадлежит другому бизнесу |
| 500 `INTERNAL_ERROR` | временная ошибка; провайдер повторит, идемпотентность делает это безопасным |

- **Тела ответов** не содержат id тенанта, бизнеса, звонка, клиента и номеров
  (проверено тестами и вживую).
- **Логи** — только коды и имя провайдера, без секрета и без номеров.
- **Повторная доставка** — идемпотентность по `providerEventId`.

**Что заменить или добавить в MCR-8 для реального провайдера:**
- проверка подписи провайдера (обычно HMAC тела с меткой времени), с окном
  допуска по времени против повторов и, если провайдер поддерживает,
  allowlist IP;
- секреты на подключение в защищённом хранилище, а не глобальный env;
- приведение номеров к E.164 в адаптере;
- сопоставление статусов провайдера с четырьмя `CallEventType`, включая
  `wasAnswered`;
- проверка, что `providerCallId` и `providerEventId` стабильны у провайдера.

### 17. Audit / system actor decision

- Модели AuditLog **нет**. `AiLog` относится к AI-событиям и требует
  связанный диалог, поэтому для звонков не подходит.
- Приём звонков **не использует `AuthContext` и не выдаёт себя за
  пользователя**: тенант и бизнес — результат маршрутизации, все запросы
  ограничены ими. Фиктивного owner, как в Telegram-контексте вебхука, нет.
- **Авторитетный журнал:** сама запись звонка (итог, время провайдера и время
  получения, `outcomeDetectedAt`) плюс неизменяемый реестр `call_events`
  (одна строка на событие провайдера, без payload). Шумных строк на каждый
  повтор не появляется: повтор не пишет ничего.
- **Системная идентичность** остаётся будущим требованием, когда
  автоматизация начнёт создавать записи от имени системы (MCR-4 и далее).

### 18. Explicit proof that no customer contact occurs

- **Код:** `callIntakeService` импортирует только репозитории номеров,
  бизнеса, клиентов и звонков, транзакцию и нормализацию. Каналов, доставок,
  сообщений, диалогов, AI, заявок и записей среди импортов нет.
- **Тесты:** реестр канальных адаптеров, доставки, сообщения, диалоги,
  записи, заявки, `aiService` и `customerRepository.create` заменены
  «ловушками». `afterEach` проверяет, что ни одна не сработала, **в каждом из
  49 тестов**.
- **Вживую:** сообщений, доставок, диалогов, заявок, записей и AI-логов в
  тестовом тенанте до и после — одинаково (53 / 7 / 44 / 38 / 32 / 30).
  Клиентов не создано, кроме подготовленного для проверки.

### 19. Live mock verification results

`walkMcr2.mjs`: dev-сервер, основной Supabase, тестовый тенант `p48-1-check4`,
mock-провайдер. **19 / 19 PASS:**

- **Подготовка:** тестовый номер бизнеса (`+7******3442`, Алматы) и тестовый
  клиент. Повторное добавление того же номера → 409.
- **CASE 1** — пропущенный от известного клиента: 1 запись, верные тенант и
  бизнес, канонический номер звонящего, клиент привязан, MISSED, READY.
- **CASE 2** — неизвестный: сохранён, `customerId` null, READY, клиент не создан.
- **CASE 3** — ringing → answered → completed: ANSWERED, NOT_ELIGIBLE.
- **CASE 4** — 3 одинаковые доставки: accepted, duplicate, duplicate; 1 звонок,
  1 событие.
- **CASE 5** — missed → поздний ringing: остаётся MISSED.
- **CASE 6** — answered → поздние missed, completed(false), ringing: остаётся ANSWERED.
- **CASE 7** — неизвестный номер бизнеса: 422, ничего не записано нигде.
- **CASE 8** — `anonymous` и `12345`: сохранены, без клиента, NOT_ELIGIBLE (NO_CALLER_PHONE).
- **CASE 9** — один номер, три `callId`: три отдельных READY.
- **CASE 10** — конкурентность: 1 звонок, 3 события, 5 duplicate, без 5xx.
- **Безопасность:**
  - неверный секрет → 401, ничего не записано;
  - поддельные `tenantId`/`businessId` проигнорированы;
  - ответы без id и номеров.
- **Инварианты БД:** второй активный владелец → P2002; рассинхрон → CHECK.
- **Побочных эффектов нет**, клиентов не создано, временные метки на месте.
- **Очистка точечная**, только записи этого прогона: 22 события, 13 звонков,
  1 тестовый номер. После неё в БД 0 номеров, 0 звонков, 0 событий.
- **Реальные тенанты:** снимок до и после идентичен.

### 20. Test counts

| | Количество |
|---|---|
| Базовый уровень | **1730** |
| Добавлено | **+72** |
| Итог | **1802 / 1802**, 85 файлов |

Добавленные тесты:
- `callIntake.test.ts` — 49:
  - маршрутизация (8);
  - жизненный цикл, порядок, дубли, конкурентность, повторные звонки (11);
  - временные метки (2);
  - клиент и пригодность к восстановлению (9);
  - адаптер (13);
  - вебхук (5);
  - отсутствие побочных эффектов — проверка в каждом тесте.
- `businessPhoneNumber.test.ts` — 7: каноника, невалидный номер, роли,
  инвариант между тенантами, повтор в одном бизнесе, освобождение и повторная
  активация, изоляция.
- `telephonyIsolation.test.ts` — 8: скоупинг запросов, маршрутизация только по
  активному уникальному номеру, SQL `FOR UPDATE` с параметрами, вставки
  ON CONFLICT DO NOTHING.
- `callStateMachine.test.ts` — 8: независимость от порядка по всем
  перестановкам, `outcomeDetectedAt`, пригодность к восстановлению.

### 21. Prisma/typecheck/build results

- `npm run typecheck` — без ошибок.
- `npm run build` — успешно.
- `prisma validate` — valid; `migrate status` — up to date.
- `prisma format --check` — **старая проблема, не исправлена и не скрыта.**
  `format` меняет только старые блоки: выравнивание полей User и Business со
  времён Prompt 50. **Раздел MCR-2 после `format` не меняется**, то есть
  добавленное отформатировано верно. Вся схема ради этого не переформатировалась.

### 22. Supabase migration result

- `prisma migrate deploy` применил `20261003120000_missed_call_intake_foundation`
  к dev-базе.
- **Проверено:**
  - 3 таблицы;
  - уникальные ключи `business_phone_numbers_activePhoneE164_key`,
    `call_interactions_provider_providerCallId_key`,
    `call_events_provider_providerEventId_key`;
  - CHECK `business_phone_numbers_phoneE164_format` и
    `business_phone_numbers_active_mirror`;
  - все FK.
- Reset, удалений чужих данных и изменений реальных тенантов не было.

### 23. Files changed

**Новые:**
- `prisma/migrations/20261003120000_missed_call_intake_foundation/migration.sql`;
- `src/server/telephony/types.ts`, `src/server/telephony/callStateMachine.ts`,
  `src/server/telephony/adapters/mockTelephonyAdapter.ts`;
- `src/server/services/callIntakeService.ts`, `src/server/services/businessPhoneNumberService.ts`;
- `src/server/repositories/callInteractionRepository.ts`,
  `src/server/repositories/businessPhoneNumberRepository.ts`;
- `src/server/validation/businessPhoneNumber.schemas.ts`;
- `api/webhooks/telephony/mock.ts`, `api/business/phone-numbers.ts`,
  `api/business/phone-numbers/[id].ts`;
- `tests/callIntake.test.ts`, `tests/businessPhoneNumber.test.ts`,
  `tests/telephonyIsolation.test.ts`, `tests/callStateMachine.test.ts`;
- `docs/prompts/mcr-2.md`, `docs/final-reports/final-report-mcr-2.md`.

**Изменённые:**
- `prisma/schema.prisma` — 4 enum, 3 модели, обратные связи у Tenant,
  Business, Customer;
- `src/server/lib/env.ts` — `telephonyMockWebhookSecret`;
- `src/server/lib/dto.ts` — `BusinessPhoneNumberDto`;
- `docs/audits/missed-call-recovery-architecture-audit.md`,
  `docs/PRODUCT_BLUEPRINT.md` — статус MCR-2.

`.env` и `.mcp.json` не тронуты; секретов в коммите нет.

### 24. Remaining test data

- **Остаются:** 1 клиент «Проверка MCR-2 Клиент» в тестовом тенанте
  `p48-1-check4`. Удаления клиентов в домене нет; он не активен ни в каких
  звонках.
- **Удалены точечно:** все звонки, события и тестовый номер бизнеса этого
  прогона.
- **Локальное окружение:** dev-сервер запущен с секретом mock-вебхука в
  окружении процесса; это только локально, после перезапуска без переменной
  mock выключен.

### 25. Known limitations

- **Только mock-провайдер;** реальной проверки подписи нет (§16, MCR-8).
- **Деактивация номера** — события по уже начатым звонкам на этот номер
  отклоняются (422).
- **Поздний ANSWERED после MISSED** переводит `READY` → `NOT_ELIGIBLE`. MCR-4
  должен учитывать, что `READY` может смениться, пока не наступил захват
  (например, захватывать после короткой паузы).
- **Привязка клиента** делается при первом событии и при появлении клиента
  позже не пересчитывается.
- **Маршрутизация** проверяет «один бизнес на тенант» (`findFirstByTenant`),
  как и остальной код вебхуков.
- **Нет API и UI** для просмотра звонков: финальный UI вне рамок MCR-2.
- **Нет системного актора** и AuditLog (§17).
- **`prisma format --check`** не проходит на старой части схемы (§21).
- **Не реализованы:** реальная телефония, WhatsApp, SMS, маршрутизатор
  каналов, отправка восстановления, автоответы AI.

### 26. Readiness / gaps for MCR-3 / MCR-4

**MCR-3 (цены и локация)** от MCR-2 не зависит, его можно делать в любой момент.

**MCR-4 (оркестрация восстановления).**

Уже готово:
- пропущенные звонки `READY` с каноническим номером звонящего;
- клиент, если известен;
- `outcomeDetectedAt` как начало отсчёта задержки;
- индексы под выборку `READY` и под анти-спам окно;
- уникальный ключ звонка для идемпотентности.

Нужно добавить:
- состояния захвата и отправки (`CLAIMED` / `SENT` / `FAILED` или
  аналогичные) с переходом compare-and-set `READY → CLAIMED` — одно
  восстановление на звонок;
- правило анти-спам окна;
- временные метки восстановления (захват, отправка, доставка);
- маршрутизатор каналов, бизнес-инициированный диалог по номеру и
  детерминированное первое сообщение;
- механизм запуска после ответа вебхука (синхронно в вебхуке или фоново —
  исследование R0-D);
- системный актор для автоматических записей;
- обработку «поздний answered после захвата».

### 27. Git result

Один коммит `feat: add missed call intake foundation`. Он запушен в
`origin/master` без force; локальный `master` и `origin/master` совпадают,
рабочее дерево чистое. Хэш — в итоговом сообщении.
