## Final Report — MCR-4.1: Durable Recovery Trigger (Vercel Queues)

Пропущенный звонок, ставший `READY`, теперь сам запускает восстановление.
Цепочка:
1. приём звонка фиксирует `READY` в БД;
2. в Vercel Queues публикуется задание `{ callInteractionId }`;
3. вебхук сразу отвечает;
4. push-консьюмер очереди вызывает **тот же** движок MCR-4 (`processRecovery`).

Доставка из очереди — **at-least-once**. От дублей клиента защищают атомарный
захват MCR-4 и идемпотентность `ChannelDelivery`, а не очередь.

Если публикация не удалась, звонок остаётся `READY` в БД. Дальше по порядку:
1. вебхук отвечает 500, и провайдер присылает событие повторно;
2. повтор публикует задание заново;
3. если повтора нет, внутренний процессор подбирает звонок.

Схема БД не менялась. Vercel Queues — **Beta**. Проверка на реальной
инфраструктуре Vercel ещё **не выполнялась** (§29).

---

### 1. Baseline commit

`baf8874 feat: add missed call recovery engine`. Проверено до изменений:
- ветка `master`;
- `origin/master` совпадает;
- рабочее дерево чистое;
- тесты 1878 / 1878.

`vercel.json` до этой задачи в репозитории не было: деплой шёл по
автоопределению Vite и `api/`.

### 2. Current official Vercel Queue API verified

Источники проверены 2026-10-04:
- vercel.com/docs/queues (обновлена 2026-09-03);
- `/docs/queues/sdk` (2026-08-12);
- `/docs/queues/concepts` (2026-09-10);
- типы установленного пакета `node_modules/@vercel/queue/dist/index.d.mts`.

Подтверждено:
- **Отправка.** `send(topic, payload, { idempotencyKey, retentionSeconds,
  delaySeconds, headers, region })` → `{ messageId: string | null }`.
  - `null` значит, что сообщение принято на отложенную обработку.
  - Дедупликация по `idempotencyKey` идёт на сервере в окне
    `min(retention, 24 ч)`, ключ до 256 символов.
  - Повторный `send` с тем же ключом — не ошибка.
- **Консьюмер (push).** `handleCallback` (Web `Request`) или
  `QueueClient#handleNodeCallback` (Connect-стиль `(req, res)` с
  предразобранным `req.body`).
  - Возврат без ошибки = ack, исключение = повторная доставка.
  - Хук `retry(error, metadata)` → `{ afterSeconds }` или
    `{ acknowledge: true }`.
  - Метаданные: `messageId`, `deliveryCount`, `createdAt`, `expiresAt`,
    `topicName`, `consumerGroup`, `region`.
- **Конфигурация.** В `vercel.json`:
  `functions["<file>"].experimentalTriggers: [{ type: "queue/v2beta", topic,
  retryAfterSeconds, initialDelaySeconds, maxDeliveries }]`. Функция с таким
  триггером не имеет публичного URL.
- **Семантика:**
  - at-least-once, без FIFO;
  - топики разделены по deployment ID: консьюмер того же деплоя получает
    сообщения своего продюсера;
  - аутентификация — OIDC-токен деплоя, им управляет Vercel;
  - SDK требует `VERCEL_DEPLOYMENT_ID` вне dev-режима.

**Отличия от промпта:**
- Для этого Vite-проекта с функциями `(req, res)` используется
  `handleNodeCallback` на экземпляре `QueueClient`, а не top-level
  `handleCallback` (это Web/Next.js-стиль).
- Тип триггера — `queue/v2beta`.

Несовместимости не найдено.

### 3. Package/version added

`@vercel/queue@^0.7.0` (latest на дату), Node ≥ 20. Локально Node 24.
Зависимости пакета: `@vercel/oidc`, `mixpart`, `minimatch`, `picocolors`.

### 4. Topic name

`missed-call-recovery` — константа `RECOVERY_QUEUE_TOPIC` в
`src/server/recovery/recoveryJobs.ts`. Это один топик, без разбиения по
тенантам. С `vercel.json` его сверяет тест.

### 5. Producer implementation

`src/server/recovery/recoveryJobs.ts`. Интерфейс `RecoveryJobPublisher` с
методом `publish(job)` и тремя реализациями:
- `createVercelRecoveryJobPublisher()` вызывает `QueueClient#send` с
  ключом идемпотентности и `retentionSeconds: 3600`;
- `disabledRecoveryJobPublisher` работает вне деплоя Vercel (нет
  `VERCEL_DEPLOYMENT_ID`: локальный `vite dev`, тесты): ничего не публикует,
  звонок остаётся `READY`;
- тестовый подменяется через `setRecoveryJobPublisher`.

`publishRecoveryJob(id)` никогда не бросает исключение. Он возвращает
`PUBLISHED | DISABLED | PUBLISH_FAILED` и логирует только идентификаторы.

### 6. Exact READY publish point

`src/server/services/callIntakeService.ts`, функция `ingestCallEvent`:
1. Сначала `recordCallEvent` — прежняя транзакция MCR-2 без изменений логики.
2. **После её фиксации**, если итоговое `recoveryState === 'READY'`,
   вызывается `publishRecoveryJob`.
3. В остальных случаях `recoveryJob: 'NOT_REQUIRED'`.

Задание не публикуется для `ANSWERED`, исходящих, анонимных и невалидных
номеров, `NOT_ELIGIBLE`, `PENDING`, а также для звонков, которыми уже владеет
движок (`CLAIMED` / `SENT` / …).

Дубликат события, который застаёт звонок в `READY`, публикует задание снова,
с тем же ключом. Это путь восстановления после сбоя публикации.

### 7. Queue payload

`{ "callInteractionId": "<uuid>" }` и ничего больше. Схема zod `.strict()`.

В задании нет телефона, имени, текста, тенанта, бизнеса, тела вебхука или
секретов.

### 8. Publish idempotency strategy

Детерминированный ключ `missed-call-recovery:<callInteractionId>`, без
случайного UUID. Vercel отбрасывает повтор в окне `min(3600 с, 24 ч)` = 1 ч.

Если дубликат всё же дошёл до консьюмера (дедупликация не сработала или
истекло окно), захват MCR-4 превращает его в `SKIPPED`. Тесты D/E/F это
проверяют.

### 9. DB↔Queue consistency strategy

Атомарного коммита Postgres и очереди нет, поэтому порядок такой:
**сначала долговечный `READY`, затем задание.**

- Публикация **не** меняет БД. Звонок не становится `CLAIMED` или `SENT`
  оттого, что задание опубликовано.
- Сбой публикации → `PUBLISH_FAILED` → mock-вебхук отвечает
  **500 INTERNAL_ERROR** (транзиентная ошибка, провайдер повторяет). Повтор
  становится дубликатом события → звонок всё ещё `READY` → задание
  публикуется повторно.
- Если провайдер не повторит, звонок остаётся `READY`, и его находит
  `POST /api/internal/recovery/process` (`claimableWhere` включает `READY`).
- Обратный случай: сообщение опубликовано, но вебхук упал до ответа. Задание
  есть, повтор события продублирует его с тем же ключом, вреда нет.

### 10. Consumer implementation

**Маршрут** — `api/queues/missed-call-recovery.ts`:
- `new QueueClient().handleNodeCallback(handler, { retry: recoveryJobRetry })`;
- создаётся лениво при первом вызове;
- вне деплоя Vercel отвечает 404: локальная эмуляция API в `vite.config.ts`
  открывает любой файл из `api/`.

**Логика** — `src/server/recovery/recoveryJobConsumer.ts`, функция
`handleRecoveryJob(message, { messageId, deliveryCount })`:
1. Декодирует тело: объект, JSON-текст или байты.
2. Проверяет схему zod. Невалидное сообщение → `INVALID_PAYLOAD`, ack, к БД
   не обращается.
3. Вызывает `processRecovery(callInteractionId)`.
4. Исход `FAILED` → бросает `RecoveryJobRetryError`, очередь доставит
   повторно. `SENT` / `SUPPRESSED` / `NOT_ELIGIBLE` / `SKIPPED` → ack.

**`recoveryJobRetry`** (хук повтора):
- при `deliveryCount ≥ 6` возвращает `{ acknowledge: true }`;
- иначе `{ afterSeconds: 135 }` (= `RECOVERY_STALE_CLAIM_SECONDS` 120 + 15).

### 11. How existing MCR-4 service is reused

Консьюмер вызывает **тот же** `processRecovery` из
`src/server/services/callRecoveryService.ts`, что и внутренний процессор.
Второго движка нет.

Захват, поздний ответ, анти-спам, выбор канала, диалог, `SYSTEM`-сообщение,
`ChannelDelivery`, правила повторов и переходы состояний живут в одном месте.

Слой очереди не решает, можно ли повторять. Он лишь передаёт исход движка
транспорту: исключение = доставить снова. Решение принимает **захват MCR-4
при следующей доставке**: исчерпанные попытки, `DELIVERY_UNCERTAIN`,
устаревший звонок и завершённые состояния дают `SKIPPED` → ack.

### 12. At-least-once handling

Не утверждается, что очередь доставляет ровно один раз.

**Доставка из очереди — at-least-once. Эффект для клиента защищён
идемпотентностью MCR-4:**
- захват под `SELECT … FOR UPDATE` с проверкой состояния;
- compare-and-set из `CLAIMED`;
- одна `ChannelDelivery` на сообщение и подключение;
- `DELIVERY_UNCERTAIN` никогда не переотправляется.

### 13. Duplicate delivery proof

Тест F: одно задание доставлено дважды → `SENT`, затем `SKIPPED`.
Результат: одно сообщение, одна `SENT`-доставка, `recoveryAttemptCount = 1`.

Тест D/E: дубликат события телефонии → два задания с одним ключом → одно
сообщение.

### 14. Concurrent delivery proof

Тест G: пять параллельных доставок одного задания → ровно 1 `SENT` и 4
`SKIPPED`, одно сообщение, одна доставка.

Дополнительно: задание очереди параллельно с проходом процессора → одно
сообщение.

### 15. Late-answer proof

Тест H, два варианта:
1. `MISSED` → задание → `ANSWERED` через приём звонка → звонок
   `NOT_ELIGIBLE`, нового задания нет. Доставка старого задания → `SKIPPED`:
   0 диалогов, 0 сообщений, 0 доставок.
2. `ANSWERED` фиксируется, пока консьюмер выбирает канал. Повторная проверка
   под блокировкой даёт `NOT_ELIGIBLE`, отправки нет.

### 16. Anti-spam regression

Тест I: три пропущенных звонка одного номера с интервалом в минуту → три
задания (так и должно быть). Доставка всех трёх даёт
`SENT, SUPPRESSED, SUPPRESSED` (`ANTI_SPAM`): одно сообщение. Анти-спам
остался в MCR-4, в продюсере его нет.

### 17. Publish failure behavior

Тест J:
- `ingestCallEvent` → `recoveryJob: 'PUBLISH_FAILED'`;
- звонок `READY`, `recoveryAttemptCount = 0`, `recoveryClaimedAt = null`;
- вебхук ответил 500, повтор провайдера ответил 200 `duplicate` и опубликовал
  задание;
- доставка → `SENT`.

В лог пишется событие `recovery_job_publish_failed` с полями
`callInteractionId`, `publisher` и `errorName`. Текст ошибки в лог не
попадает.

### 18. Consumer retry behavior

**Тест L (падение после захвата, до отправки):**
1. Исключение → повторная доставка, звонок остаётся `CLAIMED`.
2. Хук повтора возвращает `afterSeconds: 135` — больше окна устаревшего
   захвата (120 с).
3. Через 135 с повторная доставка перезахватывает звонок → одно сообщение.

`retryAfterSeconds: 135` в `vercel.json` покрывает и падение или таймаут
функции, когда хук SDK не вызывается.

**Повторяемый `FAILED`** (mock-провайдер отклоняет `…0000`):
1. Три доставки → `RecoveryJobRetryError` (попытки 1–3, сообщение одно и то
   же).
2. Четвёртая доставка → `SKIPPED` (лимит MCR-4), ack.

После 6 доставок задание подтверждается (`maxDeliveries: 6` и хук), строка в
БД остаётся для сверки.

### 19. Provider-accepted / redelivery behavior

Тест M:
- `SENT`, затем потерянный ack → повторная доставка `SKIPPED`. Одна доставка,
  `attemptCount = 1`.
- Сбой после вызова провайдера, до `markSent` (доставка `SENDING`, захват
  устарел). Повторная доставка даёт `FAILED DELIVERY_UNCERTAIN` → retry →
  следующая доставка `SKIPPED` → ack. Провайдер повторно не вызывается
  (доставка всё ещё `SENDING`, `attemptCount = 1`), новых сообщений нет.

Поведение `DELIVERY_UNCERTAIN` не ослаблено.

### 20. Reconciliation processor behavior

`POST /api/internal/recovery/process` не изменён по коду, обновлено только
описание. Авторизация прежняя: Bearer `RECOVERY_PROCESSOR_SECRET`,
сравнение за постоянное время, проверка до любого доступа к БД.

Новая роль — сверка и операционный резерв:
- `READY` после сбоя публикации;
- устаревшие `CLAIMED`;
- повторяемые `FAILED`, чьё задание сдалось;
- локальная разработка.

Основной поток от него больше не зависит. Тесты:
- K — процессор восстанавливает `READY` после сбоя публикации;
- U — 401 без секрета, `{ callId }` → `SENT`;
- гонка процессора и очереди → одно сообщение.

### 21. Vercel configuration

Новый `vercel.json` — минимальный, только `functions`:

```json
{ "functions": { "api/queues/missed-call-recovery.ts": {
  "experimentalTriggers": [{ "type": "queue/v2beta", "topic": "missed-call-recovery",
                             "retryAfterSeconds": 135, "maxDeliveries": 6 }] } } }
```

- Без `rewrites`, `framework` и `buildCommand`: автоопределение Vite и
  остальных функций `/api/*` не меняется.
- Next.js-допущений нет.
- Тест сверяет путь, топик, задержку и лимит с константами кода.
- `vite build` успешен.

### 22. Environment / secrets

- Новых переменных нет.
- Аутентификация очереди — OIDC-токен деплоя, им управляет Vercel. Токен не
  задаётся и не коммитится.
- Регион SDK берётся из `VERCEL_REGION`.
- Определение деплоя — по `VERCEL_DEPLOYMENT_ID`, его задаёт Vercel.
- `RECOVERY_MOCK_CHANNEL_ENABLED` для очереди не нужен: очередь и канал — раздельные
  вещи.
- В `.env.example` добавлен блок с пояснением и пустым
  `RECOVERY_PROCESSOR_SECRET=`.
- `.env` не коммитится (`.gitignore`).

Секретов нет в Git, логах, задании очереди, ответах API и в этом отчёте.

### 23. Webhook critical-path effect

На пути вебхука:
1. транзакция приёма;
2. один вызов `send` (HTTP к Vercel Queues; запись в 3 AZ до ответа).

Вне пути вебхука (тест V проверяет: после ответа 200 в БД 0 сообщений и 0
доставок, звонок `READY`):
- выбор канала;
- создание диалога и сообщения;
- вызов провайдера канала;
- AI (не участвует вовсе).

### 24. Observability

Структурные логи через существующий `logger`:

| Событие | Поля |
|---|---|
| `recovery_job_published` | `callInteractionId`, `queueMessageId`, `publisher` |
| `recovery_job_publish_failed` | `callInteractionId`, `publisher`, `errorName` |
| `recovery_job_processed` | `queueMessageId`, `deliveryCount`, `callInteractionId`, `outcome` |
| `recovery_job_invalid_payload` | `queueMessageId`, `deliveryCount` |
| `recovery_job_failed` | `queueMessageId`, `deliveryCount`, `errorName` |
| `recovery_job_gave_up` | `queueMessageId`, `deliveryCount` |

Телефонов, текстов, тел вебхуков и секретов в логах нет. Метрики очереди
смотрятся в Vercel Queues Observability; своего дашборда нет.

### 25. Tenant / security validation

- Задание не может выбрать тенант. Схема `.strict()` отвергает
  `tenantId` / `businessId` (тест P → `INVALID_PAYLOAD`, к БД не
  обращается).
- Тенант и бизнес берутся из строки звонка внутри движка. Звонок тенанта 2
  восстанавливается только подключением и в данных тенанта 2 (тест P).
- Невалидное сообщение (нет id, не UUID, SQL-подобная строка, `null`, мусор)
  → ack, `$queryRaw` не вызывался (тест N).
- Несуществующий UUID → `SKIPPED`, ничего не записано (тест O).
- Маршрут консьюмера на Vercel недоступен извне (особенность триггера), а
  локально отвечает 404.

### 26. Proof AI is not called

В `tests/recoveryQueue.test.ts` ловушки на `aiService` и `aiProviderFactory`
проверяются в `afterEach` каждого теста (0 срабатываний). Слой очереди AI не
импортирует, движок детерминирован (`MISSED_CALL_RECOVERY_V1`).

Входящий ответ клиента по-прежнему не запускает AI: тесты MCR-4 и Telegram
зелёные, код не менялся.

### 27. Proof no Customer / Request / Appointment is auto-created

Ловушки в `afterEach` каждого теста, 0 срабатываний:
- `customerRepository` (разрешён только поиск `findActiveByPhoneE164` для
  приёма звонка);
- `vehicleRepository`;
- `customerRequestRepository`;
- `appointmentRepository`.

Тест V: у созданного диалога `customerId: null`.

### 28. Local integration verification

Тест V, сквозной путь на реальном коде приёма звонка, вебхука, продюсера,
консьюмера, движка, маршрутизатора, шаблона, `deliverSystemMessage` и
mock-WhatsApp (in-memory Prisma-дублёр, как в тестах MCR-4):
1. mock-телефония `call.missed`;
2. `READY`;
3. задание `{ callInteractionId }`;
4. `handleRecoveryJob`;
5. MCR-4;
6. диалог WhatsApp, `SYSTEM`-сообщение и `ChannelDelivery SENT`, звонок
   `SENT`.

Это **локальный интеграционный тест**. Vercel Queues в нём заменён тестовым
издателем, который записывает задания и передаёт их в настоящий консьюмер.

### 29. Was REAL Vercel Queue tested?

**Нет.** Проект не связан с Vercel CLI локально (нет `.vercel/`), учётных
данных для preview-деплоя в этой сессии нет. Отправка в настоящий Vercel
Queue и вызов настоящего консьюмера **не проверялись**.

Что проверить на первом деплое:
1. Сборка принимает `experimentalTriggers`.
2. В Vercel Queues Observability появились топик `missed-call-recovery` и
   группа консьюмеров.
3. Mock-звонок на preview с `TELEPHONY_MOCK_WEBHOOK_SECRET` даёт
   `recovery_job_published`, затем `recovery_job_processed`. В production
   mock-канал выключен, поэтому ожидаемый исход там — `FAILED
   NO_ELIGIBLE_CHANNEL`.
4. OIDC включён в проекте; для новых проектов это значение по умолчанию.

### 30. Tests before/after

| | Количество |
|---|---|
| До | **1878 / 1878**, 87 файлов |
| Добавлено | **+35** (`tests/recoveryQueue.test.ts`) |
| После | **1913 / 1913**, 88 файлов |

Покрыты пункты A–V из промпта, плюс:
- PENDING;
- отсутствие задания после `SENT`;
- выбор издателя по окружению;
- гонка с процессором;
- исчерпание повторов;
- лимит доставок;
- декодирование JSON-текста и байтов;
- 404 маршрута вне Vercel;
- сверка `vercel.json`.

Существующие тесты не менялись. MCR-1…4, Telegram, AI-черновик, приём,
квалификация, запись и изоляция тенантов — все зелёные.

### 31. Build / typecheck / Prisma

- `npm run typecheck` — без ошибок.
- `npm run build` — успешно (предупреждение о размере чанка существовало и
  раньше).
- `prisma validate` — valid.
- `prisma migrate status` — 21 миграция, «Database schema is up to date».
- `prisma format --check` — не трогался (старая проблема, не связана с
  задачей).

### 32. Migration

**Миграции нет.** Схема не менялась: долговечное состояние уже есть в
`CallInteraction` (`READY` / `CLAIMED` / `FAILED` + `updatedAt`), а
долговечность задания обеспечивает Vercel. Отдельная таблица заданий не
нужна.

### 33. Files changed

**Новые:**
- `src/server/recovery/recoveryJobs.ts` — топик, схема, ключ, издатели;
- `src/server/recovery/recoveryJobConsumer.ts` — консьюмер и хук повтора;
- `api/queues/missed-call-recovery.ts` — Vercel push-консьюмер;
- `vercel.json` — триггер очереди;
- `tests/recoveryQueue.test.ts`;
- `docs/prompts/mcr-4.1.md`, `docs/final-reports/final-report-mcr-4.1.md`.

**Изменённые:**
- `src/server/services/callIntakeService.ts` — публикация после фиксации,
  поле `recoveryJob`;
- `api/webhooks/telephony/mock.ts` — 500 при `PUBLISH_FAILED`;
- `api/internal/recovery/process.ts` — только комментарий о новой роли;
- `.env.example`;
- `package.json`, `package-lock.json` — `@vercel/queue`;
- `docs/PRODUCT_BLUEPRINT.md`,
  `docs/audits/missed-call-recovery-architecture-audit.md`.

### 34. Known limitations

- **Нет реальной проверки на Vercel** (§29).
- **Нет автоматического расписания сверки.** Если провайдер не повторит
  вебхук после сбоя публикации, звонок ждёт вызова процессора (оператор или
  внешний планировщик). Звонок не теряется, но и сам не восстановится.
  - Тот же резерв нужен, если задание сдалось через 6 доставок, или если
    захват держал процессор и тот упал.
- **Окно дедупликации — 1 час.** Дальше дубликаты гасит только захват MCR-4,
  этого достаточно.
- **Топики привязаны к деплою.** Задания, опубликованные старым деплоем,
  обрабатывает старый деплой, пока они не истекут или деплой не удалят.
- **Повтор `FAILED` идёт с фиксированной задержкой 135 с.** Это не
  экспоненциальная задержка, но укладывается в лимит MCR-4 (3 попытки, 30
  минут).
- **Остаются ограничения MCR-4:** нет реального WhatsApp, `SENT` = провайдер
  принял, нет UI для `DELIVERY_UNCERTAIN`.

### 35. Beta-risk note

Vercel Queues — публичная **Beta**:
- API, тип триггера `queue/v2beta`, поведение и цены могут меняться;
- строгой резидентности данных при отказе региона нет.

Риск ограничен:
- всё Vercel-специфичное — это `createVercelRecoveryJobPublisher` и один
  файл маршрута;
- `RecoveryJobPublisher` и `handleRecoveryJob` не зависят от провайдера;
- замена очереди не затронет MCR-4;
- при сбое Beta-сервиса долговечный `READY` и процессор сверки остаются.

### 36. Readiness for MCR-5

MCR-4.1 не трогал AI и входящие сообщения. Готово для MCR-5: автоматический
долговечный запуск первого сообщения плюс всё, что перечислено в §30
отчёта MCR-4.

Для триггеров AI-ответа MCR-5 можно переиспользовать тот же шаблон:
1. долговечное состояние в БД;
2. задание в очереди с id;
3. идемпотентный обработчик.

Это будет отдельный топик. MCR-5 не начинался.

### 37. Git result

Один коммит `feat: add durable recovery queue trigger`. Он запушен в
`origin/master` без force; локальный `master` совпадает с `origin/master`,
рабочее дерево чистое. Хэш — в итоговом сообщении.

---

### Critical acceptance test

**Вопрос 1.** Клиент звонит, звонок пропущен, MCR-2 фиксирует `READY`. Может
ли AUTOSERVISE в развёрнутом окружении Vercel с настроенными Queues
автоматически запустить восстановление MCR-4 без оператора, без ожидания
Cron, без таймера в памяти и без AI?

**Ответ: PARTIAL**, оговорка одна — нет проверки на реальной инфраструктуре.

По коду ответ — да:
1. `ingestCallEvent` сразу после коммита `READY` вызывает `send` в Vercel
   Queues.
2. Vercel сам вызывает push-консьюмер `api/queues/missed-call-recovery.ts`
   (триггер в `vercel.json`).
3. Консьюмер вызывает `processRecovery`.

В этой цепочке нет кнопки, Cron, `setTimeout` или очереди в памяти. Первое
сообщение — детерминированный шаблон, без AI.

YES станет можно поставить после первого деплоя по чек-листу §29: этот путь
локально проверен только интеграционным тестом с подменённым транспортом.
Кроме того, в production сейчас нет реального канала восстановления, поэтому
запущенное восстановление честно завершится `FAILED NO_ELIGIBLE_CHANNEL`
(это MCR-7, а не триггер).

**Вопрос 2.** Если публикация упала сразу после фиксации `READY`, можно ли
восстановить звонок позже?

**Ответ: YES.**
- Публикация идёт после коммита и состояние не меняет: звонок остаётся
  `READY` (тест J).
- Вебхук отвечает 500. Повтор провайдера — это дубликат события, звонок
  всё ещё `READY`, задание публикуется заново с тем же ключом (тест J,
  вебхук).
- Без повтора `claimableWhere` процессора включает `READY`, и
  `POST /api/internal/recovery/process` восстанавливает звонок (тест K →
  `SENT`).
- Оговорка: в production этот резерв нужно вызвать — расписания для него нет
  (§34).
