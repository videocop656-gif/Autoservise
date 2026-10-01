## Final Report — Prompt 52: AI Administrator MVP Readiness Audit

**Только аудит.** Код приложения, схема, миграции и данные Supabase не менялись. Добавлены только два документа (§22).

### 1. Executive summary
Сегодня в Autoservise есть две **рабочие, но не соединённые** половины.

**Первая — канал Telegram.** Работает по-настоящему:
- вебхук с секретом;
- маршрутизация в тенант;
- идемпотентный приём;
- сохранение `Conversation` / `Message`;
- ответ оператора через Bot API с отслеживанием доставки.

**Вторая — AI-ядро.** Тоже работает по-настоящему:
- провайдер OpenAI или mock;
- контекст бизнеса;
- 4 инструмента, вызывающие **авторитетные** сервисы Prompt 50/51: `check_availability`, `create_appointment`, `reschedule_appointment`, `cancel_appointment`;
- безопасность, эскалации, аудит.

Но AI вызывается **только вручную сотрудником** со страницы «AI-администратор» (`POST /api/ai/analyze`). Сотрудник выбирает диалог и **сам вводит текст**. Ответ модели **никогда не сохраняется как Message и никогда не отправляется** клиенту.

Входящее сообщение Telegram **намеренно никогда не вызывает AI**. Это закреплено регрессионным тестом `tests/telegramAiRegression.test.ts`.

**Вывод:** AI-администратора, который ведёт клиента в Telegram, сегодня нет. Есть канал, где все ответы и все действия с записями выполняет оператор, и отдельная консоль, где оператор может прогнать AI вручную.

### 2. Direct answer — «How far can the current AI administrator take a real Telegram customer today?»
**До сохранённого входящего сообщения — и всё.**

Сообщение «Здравствуйте. Нужно поменять передние тормозные колодки на Kia Rio. Можно завтра после обеда?»:
1. Проходит проверку секрета.
2. Попадает в нужный тенант.
3. Сохраняется как `Message(INBOUND, CUSTOMER)` в `Conversation` этого Telegram-чата. Для нового пользователя `customerId = null`.

На этом автоматизация заканчивается. AI не вызывается, клиент ответа не получает. Каждый следующий шаг делает оператор:
- найти или создать клиента и автомобиль;
- создать обращение;
- выбрать услугу;
- подобрать слот;
- создать запись;
- написать и отправить ответ.

AI можно применить только как вспомогательный инструмент: оператор вручную переносит текст в консоль AI, а затем вручную переносит ответ модели в чат.

### 3. Capability map
| Возможность | Статус | Коротко |
|---|---|---|
| Приём Telegram | **READY** | Вебхук, секрет, `connectionId` → тенант, идемпотентность, только текст в личных чатах |
| Conversation / Message | **READY** | Создание или повторное использование по chat id, повторное открытие закрытого диалога, сохранение сообщения |
| AI runtime в канале | **DISABLED** | Входящий конвейер AI не вызывает (закреплено тестом); AI доступен только из ручной консоли |
| AI runtime как таковой | **PARTIAL** | Цикл провайдера, инструменты, безопасность и эскалация работают, но только по ручному запросу; ответ нигде не сохраняется и не отправляется |
| Знания и правила бизнеса | **PARTIAL** | Услуги (цена, длительность), Knowledge, Rules и профиль передаются; **рабочих часов и текущей даты нет** |
| Идентификация клиента | **MISSING** (для Telegram) | Привязка только через `CustomerChannelIdentity`, которую создаёт лишь совпадение по телефону, а Telegram телефон не передаёт. Автоматического создания клиента нет |
| Идентификация автомобиля | **MISSING** | Ни инструмента, ни логики. AI видит автомобиль, только если он уже есть в связанном обращении |
| Создание CustomerRequest | **MISSING** для AI | Мост Prompt 49 — только кнопка оператора |
| Определение услуги | **PARTIAL** | Модель видит список услуг с id и сама выбирает `serviceId`. Кода сопоставления, алиасов и обработки неоднозначности нет |
| Доступность (AI) | **PARTIAL** | `check_availability` вызывает канонический `checkAvailability` (часы, длительность, мощность, автомобиль, часовой пояс). Но дату «завтра» модель вычислить не может — текущая дата ей не передаётся |
| Предложение слотов | **PARTIAL** | Слоты приходят от сервера, правило 8 промпта запрещает выдумывать время. Но код не проверяет, что ответ содержит только эти слоты, и ответ клиенту не уходит |
| Подтверждение клиентом | **PARTIAL** | Есть история последних 20 сообщений и шлюз подтверждения. Но предложенные слоты нигде не сохраняются; ответ AI не попадает в историю; «Давайте в 15:30» шлюзом **не** считается подтверждением |
| Создание записи AI | **PARTIAL** | Реально вызывает авторитетный `createAppointment` (блокировка, мощность, автомобиль, часы). Требует известных `customerId` и `vehicleId` и запускается только из ручной консоли |
| Ответ в Telegram | **READY** для оператора, **MISSING** для AI | Отправляются только `OUTBOUND` + `STAFF` сообщения по кнопке оператора |
| Эскалация | **PARTIAL** | Создаётся только из ручного анализа (`needsHuman`); видна в «Рабочей очереди». Из канала автоматически не возникает |
| Перехват оператором | **READY** | Оператор и так ведёт весь диалог: отвечает и отправляет из карточки диалога |

### 4. Exact runtime path
**Входящий поток (автоматический):**

```
Telegram → POST /api/webhooks/telegram/:connectionId                (api/webhooks/telegram/[connectionId].ts)
  1. секрет X-Telegram-Bot-Api-Secret-Token vs env TELEGRAM_WEBHOOK_SECRET (timing-safe) → 401
  2. resolveTelegramWebhookContext(connectionId) → tenant/business      (channels/telegramWebhookContext.ts)
  3. receiveIncoming(ctx, connectionId, update)                          (services/channelMessageService.ts)
       adapter.parseIncoming → только text + private chat               (channels/adapters/telegramAdapter.ts)
       идемпотентность по externalMessageId `telegram:<chat>:<msg>`
       resolveCustomerForInbound → identity по from.id, иначе телефон (у Telegram нет) → customerId = null
       recordInboundMessage → Conversation (по chat id; reopen CLOSED) + Message(INBOUND, CUSTOMER) + ChannelMessage
  4. 200 { ok: true }
  ── КОНЕЦ. AI не вызывается, ответ не создаётся. ──
```

**Ручной путь AI (сотрудник, страница «AI-администратор»):**

```
POST /api/ai/analyze { conversationId, message }      ← текст вводит сотрудник
  analyzeMessage (services/aiService.ts)
    buildAiContext → business, services, knowledge, rules, customer (если в диалоге),
                     vehicle + записи + история (только через связанное обращение)
    история: последние 20 Message диалога
    до 3 вызовов инструментов → executeTool (ai/tools/registry.ts) → appointmentService (P50/51)
    Zod + safety → needsHuman → createOrReuseActiveEscalation
  ответ JSON сотруднику; Message НЕ создаётся, в Telegram НЕ отправляется
```

**Ручной ответ оператора:**

```
ConversationDetailPanel → POST /api/conversations/:id/messages (STAFF, OUTBOUND)
  → POST /api/channels/:id/messages/:messageId/send → sendMessageViaChannel → Telegram sendMessage
```

### 5. Scenario A — known customer + vehicle («Нужно поменять масло. Можно завтра после 15?»)
- **Автоматически:** сохранение сообщения. Диалог этого чата уже несёт `customerId`, если оператор привязал клиента раньше (диалог уникален на чат).
- **Дальше вручную.** Если оператор прогоняет текст через консоль AI:
  - модель видит клиента, но автомобиль — только если у диалога есть обращение с автомобилем;
  - модели нужно перевести «завтра» в `YYYY-MM-DD`, а текущая дата ей не передаётся — это ненадёжно;
  - при верной дате `check_availability` вернёт реальные слоты после 15:00 (`preferredTimeFrom`);
  - ответ видит **только оператор** и должен сам написать клиенту;
  - когда клиент подтвердит, оператор снова вводит текст в консоль; `create_appointment` пройдёт, только если текст начинается с «Да…» / содержит «подтверждаю» и `vehicleId` известен.
- **Итог:** первый ручной шаг — сразу после приёма сообщения.

### 6. Scenario B — new Telegram user («Kia Rio 2019, нужно поменять передние колодки»)
- **Автоматически:** `Conversation` с `customerId = null` и сохранённое сообщение.
- **Точка остановки:** приём. Клиента и автомобиль AI создать не может (инструментов нет), обращение — тоже.
- **AI-консоль:** может ответить ценой и длительностью из `Service`, если модель сама подберёт услугу. `create_appointment` невозможен без `customerId` / `vehicleId`.
- **Оператор:** создаёт клиента и автомобиль в «Клиенты» / «Автомобили», затем «Создать обращение» в диалоге (мост P49 запишет `customerId` в диалог).

### 7. Scenario C — capacity race
Подразумевается ручной путь AI, потому что автоматического нет.

1. `create_appointment` → `createAppointment` → блокировка бизнеса → `409 CAPACITY_EXCEEDED`. **Двойного бронирования нет.**
2. `toToolFailure` (`ai/tools/errors.ts`) не знает этот код: он не `APPOINTMENT_CONFLICT`, а сообщение «На выбранное время нет свободных постов.» не совпадает ни с одним шаблоном. Поэтому результат — `INVALID_INPUT`, без `retryable`.
3. Модель получает этот результат и может сама снова вызвать `check_availability` в пределах 3 вызовов, но ничто к этому не ведёт.
4. Mock-провайдер в таком случае отвечает «Не удалось выполнить это действие — обратитесь к сотруднику автосервиса.» с `needsHuman = true`, что создаёт эскалацию.

**Итог:** данные защищены, восстановление (свежие слоты, альтернативы) **не реализовано**.

### 8. Scenario D — ambiguous service («Что-то стучит спереди»)
- Кода сопоставления симптомов нет; всё решает модель по промпту. Правило 4 запрещает диагноз, правило 2/12 требуют `needsHuman`, правило 16 — признать симптом и сослаться на историю.
- Защитный слой `safety.ts` ловит выдуманный диагноз.
- **Ожидаемо:** уточнение или `needsHuman = true` → эскалация. Но только в ручной консоли; в Telegram клиент ответа не получит.

### 9. Scenario E — «Позовите администратора»
- **В канале:** сообщение сохраняется, эскалация **не** создаётся. Оператор увидит его только в списке диалогов. В «Рабочую очередь» оно не попадает: туда идут только эскалации и NEW-обращения.
- **В консоли AI:** модель, следуя правилу 12, обычно ставит `needsHuman`, и создаётся / переиспользуется эскалация. Отдельного распознавания «просьбы человека» в коде нет.

### 10. Operator dependency map
| Stage | Status | Automatic today? | Operator action required | Evidence |
|---|---|---|---|---|
| Telegram inbound | READY | Да | — | `api/webhooks/telegram/[connectionId].ts`, `receiveIncoming` |
| Conversation | READY | Да | — | `channelInboundRepository.recordInboundMessage` |
| Customer | MISSING | Нет (кроме ранее привязанного диалога) | Создать клиента, привязать к диалогу | `channelCustomerService.resolveCustomerForInbound` (телефон у Telegram отсутствует) |
| Vehicle | MISSING | Нет | Создать или выбрать автомобиль | AI-инструмента нет; `contextBuilder` берёт автомобиль только из обращения |
| CustomerRequest | MISSING (AI) | Нет | «Создать обращение» в карточке диалога | `conversationRequestService` вызывается только из `api/conversations/[id]/request.ts` |
| Service identification | PARTIAL | Только внутри ручного анализа (модель) | Выбор услуги | `contextBuilder` (список услуг), без кода сопоставления |
| Knowledge/rules | PARTIAL | Только в ручном анализе | Ответ клиенту | `contextBuilder`: услуги / knowledge / rules есть, часов и даты нет |
| Availability | PARTIAL | Только в ручном анализе | Подбор слота (UI P51 или консоль) | `checkAvailabilityTool` → `appointmentService.checkAvailability` |
| Slot proposal | PARTIAL | Нет | Написать клиенту | ответ `analyze` не создаёт Message |
| Customer confirmation | PARTIAL | Нет | Перенести ответ клиента в консоль или записать вручную | `confirmation.ts`; предложенные слоты не сохраняются |
| Appointment creation | PARTIAL | Только из ручного анализа | Создать запись (UI) | `createAppointmentTool` → `createAppointment` |
| Outbound reply | READY (staff) / MISSING (AI) | Нет | Написать и отправить | `sendMessageViaChannel` принимает только `STAFF` / `OUTBOUND` |
| Escalation | PARTIAL | Только из ручного анализа | — | `createOrReuseActiveEscalation` вызывается только из `aiService` |
| Operator takeover | READY | — | Оператор ведёт всё | `ConversationDetailPanel` → messages + send |

### 11. AI availability integration result
**Канонический путь используется.**
- `check_availability` → `executeCheckAvailability` → `appointmentService.checkAvailability`. Это тот же генератор, что за режимом дня `GET /api/appointments/availability` (P51).
- Учитывает рабочие часы, `Service.durationMinutes`, пиковую мощность (P50, включая мощность > 1), конфликт автомобиля при заданном `vehicleId` и `Business.timezone`; не предлагает уже начавшиеся слоты; поддерживает `preferredTimeFrom` / `preferredTimeTo` («после обеда»).
- Возвращает реальные слоты с `localStart` / `localEnd` в часовом поясе бизнеса.

**Ограничения:**
1. Нужна точная дата `YYYY-MM-DD` и `serviceId`; текущая дата модели не передаётся, так что «завтра» не вычисляется надёжно.
2. Исключения записи при переносе (P51) у инструмента нет. При `reschedule_appointment` на соседнее время модель может не увидеть собственный слот записи; сам перенос при этом сервер выполнит корректно.
3. Инструмент «активен» только внутри ручного `POST /api/ai/analyze`.

### 12. AI Appointment creation result
**Существует и выполняется по-настоящему**, через авторитетный путь P50:
- `createAppointmentTool` → `createAppointment`: тенант, владение и активность клиента / автомобиля / услуги, длительность, часы, затем под `lockForScheduling` (`FOR NO KEY UPDATE`) конфликт автомобиля и мощность → вставка. Отдельного или устаревшего пути бронирования нет.

**Шлюзы:**
- текущий текст должен быть явным подтверждением (`confirmation.ts`);
- `customerId` / `vehicleId` должны совпадать с уже известными диалогу (`allowed`), иначе `FORBIDDEN`;
- лимит — 3 вызова инструментов.

**Пробелы:**
- идемпотентности нет: повторное «Да» по тому же слоту даст `APPOINTMENT_CONFLICT` от проверки автомобиля, а не вторую запись — дубликат предотвращает конфликт автомобиля, а не ключ идемпотентности;
- `CAPACITY_EXCEEDED` сводится к `INVALID_INPUT` (§7);
- «Давайте в 15:30» шлюзом не считается подтверждением;
- если у диалога нет клиента / автомобиля, проверка `allowed` пропускается (§15), но без известных id модели неоткуда их взять.

**Классификация: PARTIAL.** Работает только из ручной консоли; результат клиенту не уходит.

### 13. Outbound Telegram result
**Для оператора — READY:**
- `sendMessageViaChannel`: только сообщения `OUTBOUND` + `STAFF` этого диалога и этого подключения;
- `claimForSending` (атомарный захват `PENDING` / `FAILED` → `SENDING`) защищает от двойной отправки; `SENT` повторно не отправляется;
- `markSent` / `markFailed` с кодом ошибки; повтор — по кнопке;
- реальный Bot API `sendMessage` при наличии `TELEGRAM_BOT_TOKEN`, иначе mock-адаптер.

**Для AI — MISSING:** AI не создаёт Message. В enum `MessageSenderType` нет значения для AI (`CUSTOMER` / `STAFF` / `SYSTEM`), а доставка принимает только `STAFF`.

**Пробел надёжности:** доставка, «застрявшая» в `SENDING` (функция упала между захватом и `markSent`), навсегда остаётся `IN_PROGRESS`. Восстановления по времени нет.

### 14. Escalation / handoff result
- **Создаётся** только `aiService.analyzeMessage`, при `needsHuman = true` от модели или по порогу уверенности. Не создаётся при сбое провайдера (ошибка 5xx), невалидном ответе, отказе слоя безопасности и превышении лимита инструментов (там `needsHuman = true`, но эскалация намеренно не создаётся).
- **Не создаётся** из канала: просьба «позовите администратора», неподдерживаемое сообщение (фото, голос) — ничего.
- **Одна активная эскалация на диалог:** уникальный `activeConversationId`, повторное использование.
- **Статусы:** `OPEN` → `IN_PROGRESS` (claim) → `RESOLVED` / `CANCELLED`. Видны в «Рабочей очереди» и на странице эскалаций.
- **«AI перестаёт отвечать после эскалации»** — неприменимо: AI в канале и так не отвечает.
- **Перехват оператором:** оператор всегда ведёт диалог сам.

### 15. Security findings
Подтверждено кодом:
- **Граница вебхука — надёжно.**
  - Сначала проверка секрета (timing-safe), до разбора параметров и чтения БД.
  - `connectionId` из URL → тенант на сервере.
  - Чужие и неподдерживаемые обновления → безопасный 200 без данных.
- **Telegram — одна глобальная настройка.** `TELEGRAM_BOT_TOKEN` и `TELEGRAM_WEBHOOK_SECRET` — переменные окружения на весь деплой, не на тенант. `setWebhook` для одного подключения заменяет вебхук бота, поэтому реально Telegram может обслуживать **один бизнес на деплой**. Это не утечка (маршрутизация по `connectionId` + секрет корректны), но для нескольких пилотных автосервисов нужны отдельные боты.
- **Идентификаторы Telegram:**
  - `from.id` используется только для поиска `CustomerChannelIdentity` в рамках подключения;
  - имя отправителя не пишется в `Customer`;
  - диалог привязан к `chat.id` (личный чат = один пользователь).
- **Авторизация инструментов AI:**
  - аргументы проходят Zod;
  - сервисы заново проверяют тенант и владение (404 для чужих id);
  - `appointmentId` для переноса / отмены ограничен списком `upcomingAppointments` контекста.
- **Обход `allowed`:** если у диалога **нет** `customerId` / `vehicleId`, проверка `allowed` для `create_appointment` **пропускается**: подойдут любые id того же тенанта. Модель таких id не видит, а подделать UUID нереально, поэтому риск низкий. Но правило — «пропустить», а не «отказать» (P2).
- **Синтетический контекст вебхука** — `role: 'owner'`. Сейчас он используется только во входящем конвейере. При подключении AI к каналу его нужно будет пересмотреть: инструменты и эскалации будут выполняться от «owner».
- **Дубликаты:**
  - входящие — идемпотентны: уникальность `ChannelMessage`, восстановление после P2002;
  - исходящие — защищены `claimForSending`, но без восстановления «застрявших» `SENDING`;
  - записи — защищены конфликтом автомобиля и блокировкой, без ключа идемпотентности.
- **Устаревший промпт:** правило 19 системного промпта говорит модели, что «эскалации как механизма пока не существует». Это неверно с Prompt 12; не уязвимость, но устаревшая инструкция.

### 16. Existing test coverage
Базовая линия подтверждена: **1515 / 1515 PASS**, 72 файла.

| Область | Тесты |
|---|---|
| Telegram inbound | `telegramWebhook` (13), `telegramAdapter` (16), `channelMessageService` (12), `channelCustomerService` (10), `channelAdapters` |
| AI не вызывается из Telegram | `telegramAiRegression` (2) — **закрепляет текущее отключение** |
| Telegram setup | `telegramSetupService` (13) |
| AI runtime | `aiService` (44), `mockAiProvider` (40), `aiContextBuilder` (21), `aiSafety` (18), `aiResult.schema`, `aiProviderFactory`, `aiLogService` |
| AI tools | `aiTools` (32), `aiToolSchemas` (18), `confirmation` |
| Доступность / мощность / гонки | `appointmentService` (56), `appointmentCapacity` (47), `capacity.domain` |
| Доставка | `channelDeliveryService` (20) |
| Эскалация | `escalationService` (48) |
| Изоляция тенантов | `tenantIsolation` (133) |

**Не покрыто:**
- `OpenAiProvider` — реальный HTTP-путь, разбор tool calls, таймауты; тестов нет, кроме выбора фабрикой;
- сквозной сценарий «входящее Telegram → AI → ответ → доставка» (его и нет в коде);
- `CAPACITY_EXCEEDED` в инструментах AI;
- многоходовое подтверждение с реальной историей;
- «застрявшая» доставка в `SENDING`.

### 17. P0 blockers
Блокируют автоматический поток «клиент Telegram → AI → запись или передача человеку».

1. **AI не вызывается для входящих сообщений канала.** `receiveIncoming` намеренно изолирован от AI (`telegramAiRegression.test.ts`).
2. **Ответ AI не становится сообщением и не доставляется.** `analyzeMessage` не создаёт `Message`; доставка принимает только `STAFF`; отправителя «AI» в схеме нет — понадобится либо `SYSTEM`, либо решение о типе отправителя.
3. **Нет автоматической передачи человеку из канала.** Без вызова AI никакое входящее сообщение (в том числе «позовите администратора», фото, голос) не создаёт эскалацию и не попадает в «Рабочую очередь».

### 18. P1 gaps
Нужны для достоверного пилота после P0.

1. **Модели не передаётся текущая дата.** «Завтра» и «в пятницу» нельзя надёжно перевести в `YYYY-MM-DD` для `check_availability`.
2. **Рабочие часы бизнеса не входят в контекст AI.** На «До скольки вы работаете?» модель отвечает только при наличии статьи в Knowledge.
3. **Нет пути «новый клиент / автомобиль / обращение» для AI.** Без `customerId` + `vehicleId` создание записи невозможно; минимально нужно хотя бы автоматически создавать обращение и эскалировать оператору.
4. **`CAPACITY_EXCEEDED` в инструментах AI не восстанавливается.** Нужно сопоставить код с повторяемым конфликтом и вести к свежим слотам.
5. **Предложенные слоты нигде не сохраняются.** Подтверждение опирается только на историю текста, а ответы AI в историю не попадают.
6. **Шлюз подтверждения не принимает естественные формы** («Давайте в 15:30», «Подходит 15:30»).
7. **Один бот Telegram на деплой** — для нескольких пилотных бизнесов.

### 19. P2 gaps
1. Восстановление доставок, «застрявших» в `SENDING`.
2. `create_appointment` при неизвестных `customerId` / `vehicleId` пропускает проверку `allowed`, а не отказывает.
3. Инструмент доступности не поддерживает исключение записи при переносе (P51 добавил его только для HTTP).
4. Устаревшее правило 19 системного промпта.
5. Синтетический `role: 'owner'` у контекста вебхука при будущем вызове AI из канала.
6. Нет ключа идемпотентности записи (дубликаты сейчас отсекает конфликт автомобиля).
7. Тесты для `OpenAiProvider`.
8. Неподдерживаемые типы сообщений (фото, голос) молча отбрасываются — клиенту ничего не отвечается.

### 20. Smallest coherent next implementation
**«AI-черновик ответа во входящем диалоге, под контролем оператора».** Самый маленький шаг, снимающий главный блокер (P0-1/2) без риска автономных действий.

**Проблема.** AI не участвует во входящем потоке, а его ответы никуда не попадают. Оператор вручную копирует текст между консолью и чатом.

**Что можно переиспользовать:**
- `aiService.analyzeMessage` — контекст, история, инструменты, безопасность, эскалация, аудит;
- `messageService.createMessage` + `sendMessageViaChannel` — сохранение и отправка;
- `ConversationDetailPanel` — карточка, где оператор уже отвечает;
- `createOrReuseActiveEscalation`.

**Минимальный объём:**
1. В карточке диалога кнопка «Предложить ответ AI». Она вызывает `analyzeMessage` с **последним входящим сообщением** самого диалога, а не с текстом, введённым вручную.
2. Ответ модели показывается как редактируемый черновик. Оператор нажимает «Отправить», и сообщение уходит существующим путём `STAFF` / `OUTBOUND`.
3. В контекст AI добавляются **текущая дата бизнеса** и **рабочие часы** (P1-1/2): иначе черновики про «завтра» и часы работы ненадёжны.
4. Эскалация при `needsHuman` уже работает в `analyzeMessage`.

**Явно вне объёма:**
- автоматический ответ без оператора;
- вызов AI из вебхука;
- изменение изоляции Telegram;
- новые инструменты (клиент / автомобиль / обращение);
- новый тип отправителя;
- изменения доступности и мощности;
- несколько ботов.

Следующий логический шаг после этого — автоматический ответ из вебхука с эскалацией, отдельным, осознанно согласованным промптом.

### 21. Files inspected
- `api/webhooks/telegram/[connectionId].ts`
- `api/ai/analyze.ts`
- `api/channels/[id]/messages/[messageId]/send.ts`
- `api/conversations/[id]/request.ts`
- `src/server/channels/telegramWebhookContext.ts`
- `src/server/channels/channelAdapterRegistry.ts`
- `src/server/channels/adapters/telegramAdapter.ts`
- `src/server/services/channelMessageService.ts`
- `src/server/services/channelCustomerService.ts`
- `src/server/services/channelDeliveryService.ts`
- `src/server/services/telegramSetupService.ts`
- `src/server/repositories/channelInboundRepository.ts`
- `src/server/repositories/channelDeliveryRepository.ts`
- `src/server/services/aiService.ts`
- `src/server/services/escalationService.ts`
- `src/server/ai/aiProviderFactory.ts`
- `src/server/ai/providers/openAiProvider.ts`
- `src/server/ai/providers/mockAiProvider.ts`
- `src/server/ai/contextBuilder.ts`
- `src/server/ai/promptBuilder.ts`
- `src/server/ai/types.ts`
- `src/server/ai/confirmation.ts`
- `src/server/ai/tools/registry.ts`
- `src/server/ai/tools/schemas.ts`
- `src/server/ai/tools/errors.ts`
- `src/server/ai/tools/checkAvailabilityTool.ts`
- `src/server/ai/tools/createAppointmentTool.ts`
- `src/server/services/appointmentService.ts`
- `src/server/lib/env.ts`
- `src/server/validation/ai.schemas.ts`
- `prisma/schema.prisma` (`MessageSenderType`, `AiEscalationStatus`, `ChannelConnection`)
- `src/pages/settings/AiSettingsPage.tsx`
- `src/components/conversations/ConversationDetailPanel.tsx`
- `src/pages/OperationsPage.tsx`
- `tests/telegramAiRegression.test.ts` и список тестов в `tests/`

`.env` проверялся **только на наличие имён переменных**, значения не читались и не выводились. Локально `OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN` и `TELEGRAM_WEBHOOK_SECRET` не заданы, поэтому локально работают mock-провайдер и mock-адаптер. Окружение production (Vercel) из этой сессии не видно.

### 22. Files changed
- `docs/prompts/prompt-52.md` (новый)
- `docs/final-reports/final-report-52.md` (новый)

### 23. Git status
`master` = `origin/master` = `da1cce0`. Неотслеживаемые файлы — только два документа выше. Коммита нет, по условию промпта.

### 24. Explicit confirmation
- код приложения не изменён;
- Prisma-схема не изменена;
- миграции не создавались;
- данные Supabase (production и бизнес-данные) не изменялись — аудит выполнен чтением кода и прогоном существующих тестов, запросов к БД не было.
