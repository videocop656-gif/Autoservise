## Final Report — MCR-5: Automatic AI Conversation After Missed-Call Recovery

После ответа клиента на сообщение восстановления AI-администратор отвечает
сам, без кнопки оператора. Цепочка:

1. входящее сообщение и долговечная «AI-ход» запись (`AiConversationTurn`)
   фиксируются одной транзакцией;
2. в Vercel Queues уходит задание `{ messageId }` (топик `ai-conversation-reply`);
3. консьюмер атомарно захватывает ход (по одному на диалог, свежие сообщения
   поглощают старые);
4. единое AI-ядро в новом режиме `auto_reply` (только чтение свободного
   времени) готовит ответ;
5. детерминированная проверка сверяет ответ с данными сервиса: цена и её
   тип, осмотр, числа, ссылки, адрес, время, обещания записи;
6. непосредственно перед отправкой под блокировкой проверяются выключатель,
   пауза, ответ сотрудника и более новое сообщение;
7. создаётся одно сообщение `AI` и отправляется существующим конвейером
   `ChannelDelivery`.

Всё, что нельзя обосновать, клиенту **не отправляется**: эскалация, пауза и
одно честное сообщение о передаче сотруднику.

Выключено по умолчанию. Любой ответ сотрудника останавливает AI в диалоге.
AI не создаёт клиентов, автомобили, заявки и записи и не подтверждает запись.

Проверено на mock-WhatsApp и mock-AI. Реальный OpenAI **не проверялся**:
ключа нет (§39).

---

### 1. Baseline commit

`f1bc1ff feat: add durable recovery queue trigger`. Проверено до изменений:
- ветка `master`;
- `origin/master` совпадает;
- рабочее дерево чистое;
- тесты 1913 / 1913.

### 2. Schema changes

Только добавления:

| Что | Зачем |
|---|---|
| `Business.aiAutoReplyEnabled Boolean @default(false)` | выключатель уровня бизнеса |
| `Conversation.aiAutomationPausedAt`, `aiAutomationPausedReason`, `aiAutomationResumedAt` | долговечная пауза и возобновление диалога |
| `MessageSenderType` + `AI` | происхождение автоответа |
| модель `AiConversationTurn` + enum `AiTurnState` (`PENDING / PROCESSING / COMPLETED / SKIPPED / FAILED`), `AiTurnDecision` (`REPLY / HANDOFF`) | долговечная отметка «AI должен ответить» и ключ идемпотентности |

Ключевые ограничения `AiConversationTurn`:
- `inboundMessageId` **unique**: одно входящее сообщение даёт один ход;
- `replyMessageId` **unique**: один ход даёт одно исходящее сообщение;
- CHECK `attemptCount >= 0`.

Новых моделей workflow нет. Для аудита и передачи переиспользуются
`AiLog`, `Message` и `AiEscalation`.

### 3. Migration

`prisma/migrations/20261006120000_automatic_ai_conversation/migration.sql`
сгенерирована `prisma migrate diff` от схемы `HEAD`. Старые миграции не
менялись.

`prisma migrate deploy` применил её к Supabase, `migrate status` — «Database
schema is up to date». Проверено read-only запросом к живой базе:
- бизнесов 7, у всех `aiAutoReplyEnabled = false`;
- `MessageSenderType = CUSTOMER, STAFF, SYSTEM, AI`;
- три колонки `aiAutomation*` на месте;
- CHECK и оба FK таблицы ходов на месте;
- ходов 0.

### 4. Business kill switch

- Поле `aiAutoReplyEnabled`. По умолчанию выключено в схеме, миграции и
  фикстуре — тест A.
- Меняется через существующий `PATCH /api/business`: owner/admin
  (`updateBusinessProfile`). Manager получает 403 — тест.
- UI: карточка «Автоматические ответы AI» с переключателем на странице
  AI-администратора (§32).
- Выключатель проверяется трижды:
  1. при приёме сообщения: без него ход не создаётся, задания нет, AI не
     вызывается — тест B;
  2. при захвате хода;
  3. в `finalize` прямо перед созданием сообщения — тест AC (§23).

### 5. Conversation pause / takeover model

`aiAutomationPausedAt` + `aiAutomationPausedReason`. Причины:

| Причина | Кто ставит |
|---|---|
| `HUMAN_TAKEOVER` | ответ сотрудника |
| `OPERATOR_PAUSED` | оператор |
| `CUSTOMER_REQUESTED_HUMAN` / `AI_NEEDS_HUMAN` / `UNSAFE_REPLY` / `TURN_LIMIT` / `AI_FAILURE` | передача сотруднику |

Работа с паузой:
- `POST /api/conversations/:id/ai-automation { action: "pause" | "resume" }`,
  роли owner/admin/manager.
- Возобновление — только явное действие оператора.
  - Ставит `aiAutomationResumedAt`, с него заново считается лимит ходов.
  - Отказывает `409 ESCALATION_ACTIVE`, пока открыта эскалация: AI не
    говорит поверх передачи.
- Пауза в БД, поэтому переживает обновление страницы и деплой.
- Черновик AI паузу не снимает (тест AP).

### 6. AI trigger point

`channelMessageService.receiveIncoming`. Флаг считается так:
`ctx.business.aiAutoReplyEnabled && isAutoReplyChannel(канал)`.

Если флаг есть, `recordInboundMessage` в **той же транзакции**, что
`Message(INBOUND, CUSTOMER)`, создаёт `PENDING`-ход. Исключение — диалог на
паузе.

**После коммита** вызывается `publishAiReplyJob`. Webhook не ждёт ни AI, ни
доставку.

**Каналы.** Допустим только `WHATSAPP` (`AI_AUTO_REPLY_CHANNELS`):
- Telegram исключён намеренно: его поведение не меняется — тест;
- MANUAL / PHONE / OTHER / WEBSITE не участвуют;
- SMS добавится одной строкой политики, когда появится тип канала.

### 7. Queue / topic

`ai-conversation-reply` — отдельный от `missed-call-recovery` топик. Та же
инфраструктура MCR-4.1: `@vercel/queue`, `QueueClient#handleNodeCallback`.

Push-консьюмер `api/queues/ai-conversation-reply.ts`. В `vercel.json`:
- `queue/v2beta`;
- `retryAfterSeconds: 135` — больше окна устаревшего захвата 120 с;
- `maxDeliveries: 8`.

Хук повтора:

| Событие | Повтор |
|---|---|
| `BUSY` | через 20 с |
| `FAILED` | через 60 с |
| падение функции | через 135 с |
| 8-я доставка | ack |

Вне деплоя Vercel маршрут отвечает 404, а издатель «disabled»: ход остаётся
`PENDING`.

### 8. Queue payload

`{ "messageId": "<uuid>" }`, zod `.strict()`. В задании нет текста,
телефона, клиента, тенанта, бизнеса и секретов.

Ключ идемпотентности публикации:
`ai-conversation-reply:<messageId>`, retention 1 ч.

### 9. DB ↔ Queue consistency

Порядок: **сначала сообщение и ход в БД, потом задание.** Публикация
состояние не меняет.

При сбое публикации:
- `receiveIncoming` возвращает `aiReplyJob: 'PUBLISH_FAILED'`;
- ход остаётся `PENDING`;
- `POST /api/internal/ai-replies/process` его находит и обрабатывает:
  Bearer `RECOVERY_PROCESSOR_SECRET`, проверка за постоянное время, 401 без
  секрета — тест «publish failure…».

Повтор того же вебхука, пока ход `PENDING`, публикует задание снова с тем
же ключом (`republishIfPending`).

Список для сверки — `claimableTurnsWhere`: `PENDING`, повторяемые `FAILED`,
устаревшие `PROCESSING`, только моложе 30 минут.

### 10. Inbound idempotency

Защищают три уровня:
1. уникальность `ChannelMessage(channelConnectionId, externalMessageId)` —
   было и раньше;
2. уникальный `AiConversationTurn.inboundMessageId`;
3. уникальный `replyMessageId` — второго ответа на ход быть не может.

Тест D: тот же вебхук дважды даёт одно сообщение, один ход, два задания с
одним ключом и **один** ответ AI.

### 11. Concurrent processing protection

`aiTurnRepository.claim` — одна короткая транзакция:
1. `SELECT … FOR UPDATE` хода;
2. проверка, можно ли его брать;
3. `SELECT … FOR UPDATE` строки диалога — она сериализует AI-ходы диалога,
   ответ сотрудника, паузу и новые входящие;
4. другой свежий `PROCESSING` в диалоге даёт `BUSY`;
5. проверка допустимости;
6. переход в `PROCESSING` с `attemptCount + 1`.

Все последующие переходы — compare-and-set по
`(state = PROCESSING, attemptCount)`.

Тесты:
- E — повторная доставка: `SKIPPED`, одна генерация;
- F — пять параллельных доставок: ровно один `REPLIED`, одно сообщение,
  одна доставка.

### 12. AI mode architecture

Одно ядро (`aiService.runAnalysis`), режимы `interactive | draft | qualify |
auto_reply` (`executionMode.ts`). У `auto_reply` свои возможности, ничего
не наследуется:
- `toolDefinitionsForMode` предлагает модели только `check_availability`;
- `isToolAllowed` запрещает create / reschedule / cancel;
- вызывающий автомат не имеет пользователя (`BusinessScope = tenant +
  business`), поэтому мутирующий инструмент недостижим даже по ошибке:
  `executeReadOnlyTool` знает только `check_availability`;
- ядро само эскалацию не открывает — это делает воркер после своей
  проверки.

Без фиктивного пользователя: `buildAiContext`, `checkAvailability` и
`logAiAnalyze` / `logToolExecution` / `logEscalationEvent` теперь принимают
`BusinessScope`. Сигнатуры расширены, для вызовов с `AuthContext` ничего не
поменялось.

Escalation разделён на `openOrReuseEscalation(scope)` (ядро) и прежний
`createOrReuseActiveEscalation(ctx)` с проверкой роли.

Новых AI-реализаций (MissedCallAI и подобных) нет. Новые правила промпта:
блок «РЕЖИМ АВТОМАТИЧЕСКОГО ОТВЕТА» с главным принципом из §13 промпта;
остальные режимы не затронуты — тест.

### 13. Context supplied to AI

Канонический `buildAiContext`, без изменений по составу:

| Блок | Что входит |
|---|---|
| бизнес | название, адрес, `locationUrl`, часовой пояс, валюта |
| время | текущие местные дата, время и день недели |
| график | `workingHours` |
| услуги | только активные: `pricing {type, formatted, min, max}`, `priceNote`, `requiresInspection`, длительность |
| база знаний, правила | активные |
| клиент и его автомобили | только если клиент привязан |

История — не больше 20 сообщений **до** отвечаемого: клиент, сотрудник,
SYSTEM, AI.

Тенант и бизнес берутся из строки хода, а не из задания.

### 14. Pricing grounding

Правило промпта 17 (MCR-3) плюс серверная проверка:
- каждая сумма рядом с валютой должна быть `min` / `max` настроенной услуги
  или итогом из истории обслуживания;
- FROM остаётся «от …»;
- у RANGE должны быть оба конца;
- для услуги с `requiresInspection` обязателен «осмотр / диагностика»;
- «примерно / около N ₸» запрещено;
- любое число ≥ 100, которого нет в контексте или в словах клиента,
  запрещено.

Тесты:
- G/H/L — «от 40 000 ₸», осмотр, `priceNote`;
- J — FIXED;
- I — RANGE;
- K — UNAVAILABLE: в ответе ни одной цифры;
- 9 юнит-тестов валидатора.

### 15. Knowledge precedence

Цена из Service главнее Knowledge: правило 24 промпта плюс валидатор (сумма
из Knowledge не входит в разрешённые цены).

Тест M: в Knowledge «25 000 ₸»:
- ответ на «покрасить капот» содержит 40 000 и не содержит 25 000;
- модель, назвавшая 25 000, перехвачена — передача сотруднику, ни одного
  исходящего сообщения с 25 000.

### 16. Hours / location grounding

- Адрес и ссылка — только `business.address` / `locationUrl`. Упоминание
  улицы допускается, только если в ответе дословно настроенный адрес.
  Чужие ссылки запрещены.
- Тест N: адрес и ссылка на карту.
- Тест O: нет адреса — передача сотруднику, ничего не придумано.
- Часы — по графику на местный день в `Asia/Almaty`. Тест P: «Сегодня
  (понедельник) мы работаем с 09:00 до 19:00».
- Валидатор разрешает время только из слотов, графика или слов клиента.

### 17. Availability behavior

Только `check_availability` (существующий `checkAvailability`: график,
вместимость, конфликты). Слоты в ответе должны совпадать с результатом
инструмента этого хода, иначе `UNGROUNDED_TIME`.

Тест Q и сквозной сценарий: показанные времена равны первым трём слотам
прямого вызова `checkAvailability`.

Записи нет:
- выбор времени даёт «Администратор подтвердит запись в этом чате»;
- фраза «вы записаны» отсекается валидатором и safety-слоем;
- тест R: модель, запросившая `create_appointment`, получает отказ до
  исполнения, AI_TOOL_EXECUTION-лога нет.

Существующий поток Prompt 56 («Подобрать время → слот → Подтвердить
запись») не тронут.

### 18. Structured AI output

Существующий валидируемый контракт `AiResult` (zod `aiResultSchema`, тот же
JSON Schema для OpenAI Structured Outputs). Действие выводит сервер, а не
модель:

| Результат ядра | Действие |
|---|---|
| `needsHuman` | HANDOFF |
| `REJECTED` safety-слоем | HANDOFF `UNSAFE_REPLY` |
| `FAILED` (битый ответ, лимит инструментов) | как сбой провайдера |
| иначе, после валидатора | REPLY |

`NO_REPLY` на уровне модели не нужен. «Не отвечать» решают детерминированные
причины `SKIPPED`: выключено, пауза, поглощено, закрыт, сотрудник ответил и
т. п.

Модель не задаёт id: тенант, бизнес, диалог и клиент — с сервера,
`check_availability` перепроверяет `serviceId` в тенанте.

### 19. Reply safety validation

`src/server/aiConversation/replyValidation.ts` (`validateAutoReply`) —
после zod и `applySafetyLayer`. Проверяет:
- пустоту, длину (> 1000);
- внутренний текст (`needsHuman`, `business context`, JSON, `{}`, имена
  инструментов);
- обещание записи («вы записаны», «ждём вас завтра»);
- приблизительную цену, неизвестную сумму, смену типа цены, отсутствие
  оговорки об осмотре;
- лишние числа, ссылки, адрес и время;
- акции, о которых бизнес сам не писал.

Отказ **не отправляется**: передача `UNSAFE_REPLY`, код в
`AiConversationTurn.reasonCode`.

Тест Y — три небезопасных ответа: придуманная цена, «вы записаны», чужая
ссылка. Клиент каждый раз получает только сообщение о передаче.

### 20. Handoff policy

Передача сотруднику происходит, когда:
- модель поставила `needsHuman` (по правилам: диагностика, авария, цены нет,
  спор, жалоба, возврат, оплата, гарантия, опасное состояние, просьба о
  человеке, повторное непонимание);
- валидатор отказал;
- клиент явно просит человека;
- достигнут лимит ходов;
- AI исчерпал попытки.

Порядок передачи:
1. в `finalize`, под блокировкой, создаётся одно AI-сообщение
   `AI_HANDOFF_NOTICE` («Здесь лучше подключить сотрудника автосервиса. Я
   передал ему наш диалог — он ответит вам здесь.»; без срока перезвона);
2. в той же транзакции диалог ставится на паузу с причиной;
3. затем `openOrReuseEscalation` — существующая модель `AiEscalation`, одна
   активная на диалог. Причина — для оператора, по-русски, без текста
   модели;
4. `escalationId` записывается в ход.

Повтор хода досылает то же уведомление и не создаёт вторую эскалацию.

Тест X — диагностика.

### 21. Explicit human-request handling

Детерминированно, **до** вызова модели (`isExplicitHumanRequest`):
«Позовите человека / (лучше) мастера», «Соедините с мастером / живым
оператором», «Хочу поговорить с администратором», «Позвоните мне», «Нужен
мастер». Фразы вроде «Мастер сказал…» передачу не вызывают — 10 юнит-тестов.

Модель — вторая страховка.

Тест W: 0 вызовов модели, эскалация, пауза `CUSTOMER_REQUESTED_HUMAN`, одно
уведомление, `AiLog` `ESCALATED` с `messageId` входящего.

### 22. Staff takeover behavior

`messageService.createMessage` с `OUTBOUND` + `STAFF` (так отправляет
композер) в **той же транзакции**, что и сообщение, ставит паузу
`HUMAN_TAKEOVER`, если её ещё нет.

Паузу не ставят:
- SYSTEM-сообщения (восстановление);
- AI-сообщения;
- входящие.

Тест Z/AA/AB:
1. ответ сотрудника — пауза;
2. следующее сообщение клиента — ни хода, ни ответа;
3. возобновление менеджером — новый ответ AI.

Дополнительно: возобновление при открытой эскалации — 409.

### 23. In-flight kill-switch race

`finalize` под блокировкой хода и строки диалога заново читает
`business.aiAutoReplyEnabled` (и всё остальное) **до** создания сообщения.
Выключено — ход `SKIPPED AUTOMATION_DISABLED`, сообщения нет.

Тест AC: владелец выключает AI во время генерации — 0 AI-сообщений.

Мутационная проверка: если удалить эту проверку, тест AC падает.

### 24. In-flight staff-reply race

Ответ сотрудника меняет ту же строку диалога (`lastMessageAt` + пауза),
которую `finalize` блокирует `FOR UPDATE`. Исхода два, оба безопасны:
- сотрудник первый — AI видит паузу, `SKIPPED`;
- AI первый — его сообщение раньше, затем ответ сотрудника.

Тест AD: сотрудник ответил во время генерации — AI не отправил.

Мутационная проверка: убрать паузу — падают Z/AA/AB и AD.

### 25. Rapid-message behavior

Точное поведение:
- **Сериализация.** В диалоге одновременно максимум один свежий
  `PROCESSING`-ход. Другой получает `BUSY`, и очередь повторит его через
  20 с.
- **Поглощение.**
  - При захвате ход, у которого есть более новый ход в диалоге, становится
    `SKIPPED SUPERSEDED`. Порядок — `createdAt`, затем `id`.
  - Старые `PENDING` / `FAILED` ходы без ответа помечаются `SUPERSEDED`:
    их текст уже в истории нового.
- **Перед отправкой.** Если пока шла генерация пришло новое сообщение,
  ответ отбрасывается (`SUPERSEDED`), ответит новый ход с полным
  контекстом.
- Искусственных задержек и debounce нет.

Тесты AH:
- «Нужно покрасить капот» и сразу «BMW X5 2018 года», параллельно — один
  ответ, с ценой и **без** вопроса о годе;
- сообщение во время генерации — старый ответ не отправлен, новый ход
  сначала `BUSY`, потом отвечает.

### 26. Automatic-turn limit

`AI_MAX_CONSECUTIVE_AUTO_TURNS = 4` — AI-сообщений подряд с момента
последнего ответа сотрудника или возобновления. Пятый ход — передача
`TURN_LIMIT`: пауза и эскалация, без вызова модели.

Тест AK.

### 27. AI failure behavior

Сбой провайдера, ошибка конфигурации или непригодный ответ:
- клиенту ничего;
- ход `FAILED` с кодом (`AI_PROVIDER_UNAVAILABLE` / `AI_INVALID_RESPONSE`);
- консьюмер бросает исключение, очередь повторит через 60 с.

После `AI_TURN_MAX_ATTEMPTS = 3` — передача `AI_FAILURE`: эскалация, пауза
и честное уведомление. Слов «OpenAI», «API», «error» клиент не видит — тест
AI.

В `AiLog` — `FAILED` с `errorCode` и `messageId`.

### 28. Delivery failure behavior

Генерация — не доставка:
- провайдер отказал — `FAILED DELIVERY_FAILED`;
- повтор: в ходе уже есть `replyMessageId`, поэтому **то же** сообщение
  отправляется снова без генерации (тест AJ: 1 вызов модели, 1
  AI-сообщение, `attemptCount` доставки = 2);
- зависшая `SENDING` (сбой во время отправки) даёт `DELIVERY_UNCERTAIN`,
  такой ход не повторяется — тест;
- повтор перед отправкой тоже проверяет паузу и выключатель.

### 29. Message origin

`MessageSenderType.AI`, `direction OUTBOUND`. Создаёт только
`aiTurnRepository.finalize`.

Клиент API не может создать `AI`-сообщение: `createMessageSchema` его
отвергает — тест.

`deliverSystemMessage` пропускает только автоматические сообщения: `SYSTEM`
и `AI`. Staff-путь не изменён.

В UI — «Ответ AI» с иконкой, отдельно от «Сотрудник» и от «Автоматическое
сообщение» (шаблон восстановления).

### 30. AiLog

Существующий `AiLog`, `AI_ANALYZE`:
- `metadata.mode = 'auto_reply'`;
- `messageId` — входящее сообщение, которое запустило ход;
- `conversationId`, `outcome`, `intent`, `confidence`, `needsHuman`;
- `provider`, `toolCallCount`.

Детерминированные передачи записываются как `ESCALATED`, `provider: 'none'`.

Плюс прежние записи: `AI_TOOL_EXECUTION` (только `check_availability`),
`AI_ESCALATION_CREATE` / `REUSE`.

Полное решение — в `AiConversationTurn`: `state`, `decision`, `reasonCode`,
`attemptCount`, `claimedAt`, `completedAt`, `replyMessageId`,
`escalationId`.

Секретов, промпта и сырого ответа модели в логах нет.

### 31. Conversation UI

`ConversationDetailPanel`:
- секция «Автоответы AI» с бейджем:
  - «AI отвечает автоматически» — кнопка «Приостановить AI»;
  - «AI приостановлен», причина по-русски — кнопка «Возобновить AI»;
  - «Автоответы AI выключены» / «недоступны для этого канала» / «Диалог
    закрыт»;
- AI-сообщения — справа, золотистый тон, «Ответ AI» и статус доставки;
- эскалация, тред, композер и «Предложить ответ AI» остаются как были.

Логика статуса — чистая функция `aiAutomationView` (юнит-тесты).

Стиль graphite/gold. Секция идёт в том же контекстном столбце, что на
мобильной вёрстке уходит под тред.

### 32. Settings UI

На странице «AI-администратор» — карточка `AiAutoReplySettingsCard`:
- заголовок «Автоматические ответы AI»;
- переключатель `role="switch"` и бейдж «Включены / Выключены»;
- описание: AI отвечает по услугам, ценам, адресу и графику; записей не
  создаёт; при ответе сотрудника приостанавливается;
- примечание: «Включение не подключает WhatsApp само по себе»;
- для manager — только просмотр.

**Визуальная проверка в браузере (desktop / 390px) не выполнена:**
браузерные инструменты отключились в этой сессии. UI проверен typecheck,
сборкой и юнит-тестами логики статуса.

### 33. Prompt 53 regression

«Предложить ответ AI» работает, `aiDraftMode.test.ts` и
`aiConversationDraft.test.ts` зелёные. Тест AP: черновик на диалоге на паузе
работает и паузу не снимает. Режим `draft` не изменён (тест промпта).

### 34. Prompt 55 regression

`requestQualification*.test.ts` зелёные. Режим `qualify` и mock-ветка не
изменены. MCR-5 заявки не создаёт и не меняет: `customerRequestRepository`
— ловушка в каждом тесте MCR-5.

### 35. Prompt 56 regression

`requestBooking*.test.ts` зелёные. `checkAvailability` изменён только по
типу параметра (`BusinessScope`), поведение то же. Автоматического пути
создания записи нет.

### 36. MCR-4 / MCR-4.1 regression

`callRecovery.test.ts` и `recoveryQueue.test.ts` зелёные.

Изменения:
- `deliverSystemMessage` пропускает и `AI`-сообщения;
- тест конфигурации MCR-4.1 проверяет свою запись в `vercel.json`, а не
  «единственную функцию» — в файле теперь два консьюмера.

Сквозной тест MCR-5 гоняет настоящие MCR-2 → MCR-4.1 → MCR-4. Сообщение
SYSTEM не создаёт AI-ход.

### 37. Tenant isolation

- Тенант и бизнес — из строки хода. Задание с `tenantId` / `businessId`
  отвергается (`.strict()`, тест AO), без доступа к БД.
- Тест AL: ход тенанта 2 использует его услуги (30 000), его подключение и
  его диалог, без данных тенанта 1.
- Поиск хода при повторе вебхука ограничен тенантом и бизнесом.
- `tenantIsolation.test.ts` зелёный.

### 38. Vertical-slice result

Тест «missed call → … → handoff» на реальном коде, с mock-телефонией,
mock-WhatsApp и mock-AI:
1. `ingestCallEvent(MISSED)` — `READY`; задание восстановления — `SENT`;
   SYSTEM «…Вы только что звонили…».
2. «Нужно покрасить капот и крышу BMW X5» — тот же диалог, ответ AI:
   «Да, «Кузовная покраска» у нас делают. Стоимость: от 40 000 ₸. Точная
   стоимость зависит от состояния детали и объёма подготовительных работ.
   Точная стоимость определяется после осмотра. Подскажите, пожалуйста, BMW
   X5 какого года?» Один вопрос, без диагноза, без окончательной цены.
3. «А завтра после трех можно?» — реальные слоты 2026-10-06 с 15:00,
   совпадают с `checkAvailability`; записи нет.
4. «Позовите лучше мастера» — эскалация OPEN, пауза
   `CUSTOMER_REQUESTED_HUMAN`, уведомление.
5. «Алло?» — без хода и без ответа.

Итог: три AI-сообщения, все доставлены (`SENT`). Клиентов, автомобилей,
заявок и записей не создано (ловушки).

### 39. Mock AI vs real OpenAI

- **Mock AI — проверен:** весь набор тестов, детерминированный
  `MockAiProvider` с новой веткой `auto_reply`.
- **Реальный OpenAI — не проверен:** `OPENAI_API_KEY` в окружении не задан.
  Живой smoke-тест не выполнялся, ключи не использовались и не выводились.

Строгость валидатора к формулировкам реальной модели нужно посмотреть на
первом прогоне с ключом (§43).

### 40. Tests before/after

| | Количество |
|---|---|
| До | **1913 / 1913**, 88 файлов |
| Добавлено | **+73**: `aiConversation.test.ts` 44, `aiReplyValidation.test.ts` 29 |
| После | **1986 / 1986**, 90 файлов |

Изменены существующие тесты (интерфейс, не поведение):
- `messageService.test.ts` — новый 4-й аргумент `{ pauseAiAutomation }`;
- `recoveryQueue.test.ts` — проверка своей записи `vercel.json`;
- `helpers/fixtures.ts` — поле `aiAutoReplyEnabled: false`.

Мутационная проверка — тесты ловят поломку:
- без проверки выключателя падает AC;
- без паузы при ответе сотрудника падают Z/AA/AB и AD;
- без проверки цен падает M.

### 41. Build / typecheck / Prisma

- `npm run typecheck` — без ошибок.
- `npm run build` — успешно; предупреждение о размере чанка было и раньше.
- `prisma validate` — valid.
- `migrate status` — up to date, 22 миграции.
- `prisma format --check` не трогался (старая проблема).

### 42. Files changed

**Новые:**
- миграция `20261006120000_automatic_ai_conversation`;
- `src/server/aiConversation/{policy, replyValidation, aiReplyJobs, aiReplyJobConsumer}.ts`;
- `src/server/repositories/aiTurnRepository.ts`;
- `src/server/services/aiConversationService.ts`;
- `api/queues/ai-conversation-reply.ts`;
- `api/internal/ai-replies/process.ts`;
- `api/conversations/[id]/ai-automation.ts`;
- `src/components/ai/AiAutoReplySettingsCard.tsx`;
- `src/components/conversations/aiAutomation.ts`;
- `tests/aiConversation.test.ts`, `tests/aiReplyValidation.test.ts`;
- `docs/prompts/mcr-5.md`, этот отчёт.

**Изменённые:**
- `prisma/schema.prisma`, `vercel.json`;
- AI-ядро: `types/auth.ts` (`BusinessScope`), `ai/{contextBuilder,
  executionMode, promptBuilder, tools/registry, tools/checkAvailabilityTool,
  providers/mockAiProvider}`, `services/aiService`, `aiLogService`;
- сервисы: `escalationService`, `appointmentService` (тип параметра),
  `channelMessageService`, `channelDeliveryService`, `messageService`,
  `conversationService`;
- репозитории: `channelInboundRepository`, `messageRepository`,
  `conversationRepository`;
- `lib/dto.ts`, `validation/{business,message}.schemas.ts`;
- UI: `ConversationDetailPanel.tsx`, `conversations/shared.ts`,
  `AuthContext.tsx`, `AiSettingsPage.tsx`;
- тесты (§40);
- документация: `PRODUCT_BLUEPRINT.md`, аудит, `AI_BEHAVIOR_CONTRACT.md`
  (§15.1).

### 43. Known limitations

- **Реальная модель не проверялась** (§39). Валидатор намеренно строгий: он
  сверяет адрес дословно, числа — с контекстом. Реальная модель может чаще
  уходить в передачу сотруднику, чем mock. Это безопасная сторона, но долю
  передач нужно посмотреть на живых данных.
- **Нет визуальной проверки UI** в браузере (§32).
- **Реальный Vercel Queue не проверен** (как в MCR-4.1). Локально мешает
  отсутствие `VERCEL_DEPLOYMENT_ID`; на первом деплое проверить топик
  `ai-conversation-reply`.
- **Сверка не по расписанию.** Ход `PENDING` после сбоя публикации ждёт
  вызова `/api/internal/ai-replies/process`. Ходы старше 30 минут
  автоматически не отвечаются, сообщение остаётся сотруднику.
- **Доставка.** Ход с неудачной доставкой после 3 попыток остаётся `FAILED
  DELIVERY_FAILED` с видимой AI-репликой «Не отправлено»; отдельного
  уведомления оператору нет (MCR-6).
- **Неустранимое окно** между фиксацией AI-сообщения и вызовом провайдера,
  как в MCR-4. Сотрудник, ответивший в эти миллисекунды, увидит AI-ответ
  раньше своего; повторной отправки нет.
- **Mock-провайдер** сопоставляет услуги по основам слов. Смысловое
  сопоставление — задача реальной модели.
- **`NO_REPLY` от модели не выделен.** «Спасибо» получает короткий
  вежливый ответ и расходует ход в лимите.
- **Стоимость.** Ограничения: контекст (история 20), ответ 1000 символов,
  лимит 4 хода, нет генерации без допустимого входящего, нет повторной
  генерации на ход. Будущий потенантный лимит встаёт в
  `aiTurnRepository.claim` / `blockingReason` (`SKIPPED QUOTA_EXCEEDED`);
  биллинга нет.
- **Только WhatsApp (mock).** Telegram сознательно исключён.

### 44. Readiness for real WhatsApp (MCR-7)

Канальной логики в AI нет: доставка через адаптер, тред — по
`externalConversationId`.

Для MCR-7 нужно:
- реальный WhatsApp-вебхук, вызывающий тот же `receiveIncoming`. Он должен
  отвечать 5xx на `aiReplyJob: 'PUBLISH_FAILED'`, как вебхук телефонии в
  MCR-4.1;
- реальный `sendMessage` с `idempotencyKey` (уже передаётся);
- окно 24 ч и шаблоны;
- статусы доставки.

Список `AI_AUTO_REPLY_CHANNELS` уже содержит `WHATSAPP`.

### 45. Git result

Один коммит `feat: add automatic ai conversation recovery`. Он запушен в
`origin/master` без force; локальный `master` совпадает с `origin/master`,
рабочее дерево чистое. Хэш — в итоговом сообщении.

---

### Critical acceptance questions

**A — автоматический полезный обоснованный ответ без кнопки оператора: YES**
(локально, mock-WhatsApp и mock-AI).

Доказательство — сквозной тест §38. Ответ «…от 40 000 ₸ … после осмотра …
BMW X5 какого года?» отправлен через `ChannelDelivery` и получил `SENT`, без
единого действия оператора.

На развёрнутом окружении триггер — Vercel Queues (Beta, ещё не проверен
вживую). Реальный канал — MCR-7.

**B — без выдумывания услуги, цены, условий осмотра, адреса, часов и
слотов: YES.** Защита двойная:
- в контекст попадают только настроенные данные (§13);
- детерминированный валидатор перед отправкой проверяет цену и её тип,
  осмотр, числа, ссылки, адрес и время (§14–§17, §19).

Всё, что не проходит проверку, не отправляется (тест Y). Слоты — только из
`check_availability` (тест Q).

**C — AI надёжно останавливается, когда отвечает сотрудник: YES.**
- Пауза ставится в одной транзакции с сообщением сотрудника.
- Блокировка строки диалога упорядочивает её с отправкой AI.
- Проверка повторяется при захвате и в `finalize`.

Тесты Z/AA/AB и AD, мутационная проверка.

**D — может ли ответ уйти после выключения AI во время генерации: NO.**
`finalize` под блокировкой перечитывает `aiAutoReplyEnabled` до создания
сообщения. Тест AC: 0 сообщений, ход `SKIPPED AUTOMATION_DISABLED`; без этой
проверки тест падает. Повтор доставки тоже проверяет выключатель.

Остаётся только неустранимое окно в миллисекунды между фиксацией сообщения и
вызовом провайдера (§43).

**E — может ли одно входящее дать два AI-ответа: NO.** Уникальные
`inboundMessageId` и `replyMessageId`, блокирующий захват, compare-and-set и
повторная доставка того же сообщения.

Тесты:
- D — повтор вебхука;
- E — повтор задания;
- F — 5 параллельных воркеров;
- AJ — повтор доставки без новой генерации;
- AH — быстрые сообщения.

**F — может ли MCR-5 сам создать Customer, Vehicle, CustomerRequest,
Appointment: NO.**
- Режим `auto_reply` предлагает и исполняет только `check_availability`.
- У автомата нет пользователя, поэтому мутирующий путь `executeTool`
  недостижим (тест R: отказ до исполнения).
- В каждом из 44 интеграционных тестов MCR-5 записи в эти репозитории — и в
  `serviceRecordRepository` — стоят ловушками и проверяются в `afterEach`:
  0 срабатываний.
