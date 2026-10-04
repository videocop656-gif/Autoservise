## Final Report — MCR-6: Recovery Channel Router & SMS → WhatsApp Bridge

Пропущенный звонок больше **не считается разрешением** писать клиенту в
WhatsApp. Единый маршрутизатор, не привязанный к провайдеру, решает, как
восстановить звонок:
- **WhatsApp** — только если это действительно разрешено: клиент сам писал
  в WhatsApp за последние 24 ч, или есть записанное согласие и одобренный
  шаблон;
- иначе **SMS** с одной ссылкой `https://<APP_URL>/r/<токен>`, которая
  открывает WhatsApp **этого** автосервиса с готовым приветствием;
- иначе `FAILED NO_ELIGIBLE_CHANNEL`.

Маршрут и причина сохраняются на звонке и не меняются при повторах. Открытие
ссылки фиксируется, но это не согласие, не сессия и не сообщение: AI (MCR-5)
начинает работу только с настоящего входящего.

Клиенту не нужны ни приложение, ни аккаунт, ни Telegram. Все провайдеры —
mock: реальных SMS, WhatsApp и телефонии нет.

---

### 1. Baseline

`f71a002 feat: add automatic ai conversation recovery`. Проверено до изменений:
- ветка `master`;
- `origin/master` совпадает;
- рабочее дерево чистое;
- тесты 1986 / 1986.

### 2. Schema / migration

Только добавления. Миграция `20261007120000_recovery_channel_routing`
получена через `prisma migrate diff`, старые миграции не менялись,
`prisma format` по старым блокам не запускался.

| Изменение | Назначение |
|---|---|
| `ChannelType` + `SMS`, `ConversationChannel` + `SMS` | канал SMS |
| `CallInteraction.recoveryChannel` (`RecoveryRoute`: `WHATSAPP` / `SMS_BRIDGE`) и `recoveryRouteReason` | аудит маршрута |
| `ChannelConsent` | согласие, не привязанное к провайдеру |
| `RecoveryBridgeLink` | ссылки-мосты |

`ChannelConsent` хранит `tenantId`, `businessId`, `channel`,
`destinationE164`, `status OPTED_IN / OPTED_OUT`, `source` (обязательно),
`recordedAt`, `revokedAt`. Unique по
`(tenant, business, channel, destination)`.

`RecoveryBridgeLink` хранит `callInteractionId` (unique), `tokenHash`
(unique), `expiresAt`, `revokedAt`, `firstOpenedAt`, `lastOpenedAt`,
`openCount`. CHECK `openCount >= 0`.

Номер WhatsApp для клиентов отдельной колонки не получил: это ключ
`customerEntryPhone` в `config` WhatsApp-подключения бизнеса. Он проверяется
и хранится в E.164.

Применено к Supabase (`migrate deploy`, `migrate status` — up to date).
Проверено read-only:
- 0 записей согласия — у всех номеров UNKNOWN, безопасный режим;
- 0 ссылок;
- у 13 существующих звонков `recoveryChannel` = NULL;
- `SMS` есть в обоих enum;
- SMS-подключений 0.

### 3. Routing architecture

Один `selectRecoveryChannel(scope, destination, now)` в
`src/server/recovery/channelRouter.ts`. Он оценивает
`evaluateWhatsApp` и `evaluateSms` и выбирает:

```
WHATSAPP   — технически доступен, не OPTED_OUT, И (сессия открыта ИЛИ (OPTED_IN И одобренный шаблон))
SMS_BRIDGE — SMS технически доступна, не OPTED_OUT, есть WhatsApp-вход бизнеса и публичный URL
иначе      — { ok: false, reason: "WHATSAPP_<x>|SMS_<y>" }
```

Telegram никогда не кандидат: список `RECOVERY_ROUTE_CHANNELS = ['WHATSAPP',
'SMS']`. Движок MCR-4 спрашивает маршрутизатор и отправляет через выбранный
адаптер. Второго движка нет.

### 4. Capability model

`ChannelAdapter.businessInitiatedCapability(destination)` — теперь
**только техническая** возможность: провайдер настроен и доступен, номер
подходит.

Новый необязательный `recoveryTemplateAvailable(connection, templateKey)` —
одобренный шаблон у провайдера. Mock берёт его из ключа
`config.approvedTemplates`.

### 5. Consent model

`ChannelConsent`. Отсутствие записи = **UNKNOWN, и это не разрешение**.

Согласие **не** выводится из пропущенного звонка, существования клиента или
номера, старых диалогов или клика по ссылке.

Запись — только `channelConsentRepository.record()` с обязательным
источником (`CUSTOMER_OPT_IN_MESSAGE` / `CUSTOMER_OPT_OUT_MESSAGE` /
`PROVIDER_EVENT`). Кнопки «отметить согласие» нет, как и требовал §31.

### 6. Customer-service-window model

Состояние не дублируется — окно выводится из сообщений.
`isWhatsAppSessionOpen` смотрит последнее **авторитетное** входящее
WhatsApp-сообщение клиента:
- `INBOUND` / `CUSTOMER`;
- пришло через канал, то есть есть `ChannelMessage`;
- в треде `WHATSAPP` с ключом = цифры номера.

Окно открыто, если сообщение моложе `WHATSAPP_CUSTOMER_SERVICE_WINDOW_HOURS =
24`. Константа одна, в `policy.ts`. Вручную занесённые сообщения, редиректы и
клики окно не открывают — тест.

### 7. WhatsApp eligibility

Результат: `{ channel, technicallyAvailable, consent, sessionOpen,
approvedRecoveryTemplateAvailable, initiationPermitted, reason, connection }`.

Причины: `NOT_CONFIGURED`, `PROVIDER_UNAVAILABLE`, `INVALID_DESTINATION`,
`OPTED_OUT`, `SESSION_OPEN`, `TEMPLATE_AVAILABLE`, `TEMPLATE_UNAVAILABLE`,
`NO_RECORDED_CONSENT`.

`OPTED_OUT` побеждает даже открытую сессию — тест C.

### 8. SMS eligibility

Причины: `NOT_CONFIGURED`, `PROVIDER_UNAVAILABLE`, `INVALID_DESTINATION`,
`OPTED_OUT`, `WHATSAPP_ENTRY_NOT_CONFIGURED`, `BRIDGE_URL_NOT_CONFIGURED`,
`AVAILABLE`.

SMS-мост без WhatsApp-входа бессмыслен, поэтому не выбирается.

### 9. Route reason codes

В `CallInteraction.recoveryRouteReason`:

| Маршрут | Значение |
|---|---|
| WhatsApp | `WHATSAPP_SESSION_OPEN` / `WHATSAPP_TEMPLATE_AVAILABLE` |
| SMS | причина, почему **не** WhatsApp: `WHATSAPP_NO_RECORDED_CONSENT` / `_TEMPLATE_UNAVAILABLE` / `_OPTED_OUT` / `_PROVIDER_UNAVAILABLE` / `_NOT_CONFIGURED` |
| отказ | обе причины: `WHATSAPP_NOT_CONFIGURED\|SMS_NOT_CONFIGURED` |

### 10. Deterministic SMS template

`MISSED_CALL_SMS_BRIDGE_V1`:
`Вы звонили в «{название}», мастер был занят. Продолжим в WhatsApp: {ссылка}`

- Название — только из `Business.name`; длиннее 24 символов обрезается с
  «…».
- Без имени клиента, цены, цифр, диагноза, свободного времени и бренда
  AUTOSERVISE.
- Одна ссылка.
- Не AI.

`MISSED_CALL_RECOVERY_V1` сохранён — это WhatsApp-шаблон.

### 11. SMS segment result

`src/server/lib/smsSegments.ts`, `estimateSmsSegments(text)` →
`{ encoding: GSM7 | UCS2, units, segments, remainingInSegment }`:

| Кодировка | Одна SMS | Часть длинной SMS | Особенности |
|---|---|---|---|
| GSM-7 | 160 | 153 | символы расширенной таблицы считаются за два |
| UCS-2 | 70 | 67 | счёт по UTF-16, эмодзи = 2 |

Кириллица всегда даёт UCS-2. Транслитерации нет.

Шаблон с «Автосервис Тест» и URL на 53 символа
(`https://app.autoservise.test/r/…`): 125 символов — **2 сегмента**. Обрезка
названия держит его в пределах `RECOVERY_SMS_MAX_SEGMENTS = 2`, тест T
проверяет и длинное название.

При названии максимальной длины (24) в 2 сегмента помещается URL до ~53
символов, то есть `APP_URL` до ~28 символов. Более длинный `APP_URL` даёт
третий сегмент. Утилита это покажет, и это стоит контролировать при деплое.

### 12. SMS adapter

Используется существующий `ChannelAdapter` (`sendMessage` с
`idempotencyKey` = id `ChannelDelivery`, `businessInitiatedCapability`).
`ChannelType.SMS` даёт `createMockAdapter('SMS')`.

Входящие SMS отклоняются (`CHANNEL_INBOUND_UNSUPPORTED`): двусторонние SMS —
будущий этап, а поток входящего → `Conversation` → MCR-5 → исходящего для
них не реализован.

SDK реальных SMS-провайдеров не устанавливался.

### 13. Mock SMS safety

Mock SMS, как и mock WhatsApp, становится каналом восстановления только при
`RECOVERY_MOCK_CHANNEL_ENABLED=true`. В production флаг всегда считается
выключенным (`env.recoveryMockChannelEnabled`). Секретов нет.

### 14. Bridge architecture

1. SMS содержит `https://<APP_URL>/r/<token>`.
2. Правило rewrite в `vercel.json` ведёт его на `api/bridge/[token].ts`. В
   локальной разработке то же сопоставление делает `vite.config.ts`.
3. `resolveBridge(token)` отвечает `302 Location: https://wa.me/<номер>?text=…`.
4. Клиент сам нажимает «Отправить» в WhatsApp. **Только это** станет
   входящим сообщением (будущий вебхук MCR-7 → MCR-5).

Ссылка создаётся в той же транзакции, что и SMS-сообщение, так что они
фиксируются вместе.

### 15. Token security

- 16 случайных байт (128 бит), `base64url`, 22 символа.
- В БД хранится только SHA-256 токена: утёкшая таблица не даёт рабочих
  ссылок.
- Выбран вместо JWT: токен ничего не несёт (ни тенанта, ни звонка, ни
  срока), отзывается обновлением строки, ничего не нужно подписывать.
- Неверный формат отбрасывается без обращения к БД — тест J.
- Ответ на любую ошибку одинаковый: 404 с нейтральной страницей «Ссылка
  недействительна», без названия бизнеса, номера и причины.
- Заголовки `Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
  `X-Robots-Tag: noindex`.
- `POST` — 405.
- Сессии не требуется и доступа к данным ссылка не даёт.

Rate-limit в текущей архитектуре нет. Перебор при 128 битах энтропии
невозможен, неправильный формат отсекается без БД (§42).

### 16. Expiry

`RECOVERY_BRIDGE_LINK_TTL_HOURS = 72`. После срока — INVALID (тест K).
`revokedAt` — INVALID. Метод `bridgeLinkRepository.revoke` есть,
автоматических поводов отзыва пока нет.

### 17. Repeated-click behavior

Каждый клик снова перенаправляет, `openCount` растёт, `lastOpenedAt`
обновляется, `firstOpenedAt` не меняется — тест M. Повторы безопасны:
ничего, кроме счётчиков, не меняется.

### 18. WhatsApp destination

`https://wa.me/<цифры>` берётся только из `config.customerEntryPhone`
ACTIVE WhatsApp-подключения **бизнеса этой ссылки** (самое раннее с валидным
номером).

Глобального номера нет. Если у бизнеса номер не указан — INVALID, без
подстановки номера другого тенанта (тест Q). Открытого редиректа нет:
назначение не зависит от запроса.

### 19. Prefilled message

`RECOVERY_BRIDGE_PREFILL_TEXT = «Здравствуйте! Я только что звонил(а) в
автосервис.»`, закодирован `encodeURIComponent` (тест R). Без номера, id,
токена и тенанта.

### 20. Attribution

Отслеживается:
- `smsRecoveryAcceptedAt` = `CallInteraction.recoverySentAt` при
  `recoveryChannel = SMS_BRIDGE`;
- `bridgeOpenedAt` = `RecoveryBridgeLink.firstOpenedAt` плюс
  `openCount` и `lastOpenedAt`.

`whatsappInboundAt` — будущее (MCR-7). Тогда настоящее входящее WhatsApp
можно связать по треду номера.

Воронка «пропущен → SMS принята → ссылка открыта» уже считается из БД.

### 21. Privacy

- В URL, задании очереди и логах нет номера и id.
- Логи моста: `bridgeLinkId`, `callInteractionId`, причина отказа.
- Логи маршрута: маска номера (`maskPhone`).
- Ссылка в SMS — единственное место, где есть токен. В логах токена нет.

### 22. Recovery Engine integration

`callRecoveryService.processRecovery` изменён точечно. При первой попытке
создания сообщения:
1. запрос к маршрутизатору;
2. выбор шаблона по маршруту;
3. для SMS — токен.

В той же транзакции `withClaimedMissedCall`, под блокировкой, после
повторной проверки «не ответили ли»:
- диалог канала (`WHATSAPP` или `SMS`);
- `SYSTEM`-сообщение;
- ссылка-мост;
- `recoveryChannel` и `recoveryRouteReason`.

Остальное без изменений: атомарный захват, анти-спам, поздний ответ, повторы
(лимит и устаревание), `DELIVERY_UNCERTAIN`, compare-and-set.

### 23. SENT semantics

Прежняя: `SENT` = выбранный провайдер **принял** сообщение. Для SMS — что
mock-провайдер SMS принял. Это не «доставлено», не «прочитано», не «открыто»
и не «ответили». Открытие ссылки — отдельное событие.

### 24. Route audit

`recoveryChannel` и `recoveryRouteReason` записываются в транзакции создания
сообщения. Для `NO_ELIGIBLE_CHANNEL` пишется причина отказа. Тесты
VS1 / VS2 / VS3.

Без больших данных провайдера. На вопрос «почему SMS, а не WhatsApp?»
отвечает БД, а не логи.

### 25. Idempotency

Один звонок — одна отправка восстановления:
- захват под `FOR UPDATE`;
- unique `recoveryMessageId`;
- unique `RecoveryBridgeLink.callInteractionId`;
- маршрут закрепляется при создании сообщения;
- повтор доставляет то же сообщение тем же каналом и **никогда не
  перемаршрутизирует**.

Тест U: повторная доставка из очереди — одна SMS, одна доставка, одна
ссылка.

### 26. Concurrency

- Тест V: 5 параллельных обработчиков (UNKNOWN, SMS доступна) — ровно одно
  SMS-сообщение, одна доставка, одна ссылка.
- Согласие становится OPTED_IN во время гонки — одно исходящее сообщение,
  одна доставка, один канал. Победитель увидел зафиксированное согласие,
  маршрут закреплён.

### 27. Anti-spam

Не зависит от канала: считаются `SENT` / `CLAIMED` по номеру за 15 минут.

Тест W: звонок 1 ушёл SMS, затем появилось согласие, звонок 2 через 2 минуты
получает `SUPPRESSED ANTI_SPAM`, а не WhatsApp.

### 28. Late answer

Тест X:
- `ANSWERED` до захвата — `NOT_ELIGIBLE`;
- `ANSWERED` во время маршрутизации — повторная проверка под блокировкой даёт
  `NOT_ELIGIBLE`.

0 сообщений, 0 доставок, 0 ссылок.

### 29. Fallback policy

Решение явное и детерминированное:
- **До** попытки отправки — запасной путь разрешён. Маршрутизатор сам уходит
  в SMS, если WhatsApp не разрешён или технически недоступен (адаптер
  `PROVIDER_UNAVAILABLE`, нет подключения). Тест E.
- **После** попытки отправки запасного пути нет. Маршрут закреплён; отказ
  провайдера (`FAILED`, повторяемый) — повтор **того же** сообщения **тем же**
  каналом до лимита MCR-4; SMS не отправляется. Тест Y / AA: даже если
  WhatsApp потом «упал», SMS нет.
  - Причина: сообщение уже создано в WhatsApp-диалоге, отказ провайдера не
    всегда доказывает, что сообщение не дошло, а закреплённый маршрут делает
    «один путь на звонок» доказуемым.
- Нет подходящего канала — `FAILED NO_ELIGIBLE_CHANNEL`.

### 30. DELIVERY_UNCERTAIN

Тест Z: WhatsApp-доставка зависла в `SENDING` (провайдер мог принять) — `FAILED
DELIVERY_UNCERTAIN` (не повторяется), затем `SKIPPED`. SMS-запасного пути
нет, доставка одна.

### 31. Vertical slice #1

UNKNOWN: mock-телефония `MISSED`:
1. `READY`, задание MCR-4.1, консьюмер;
2. маршрутизатор: WhatsApp `NO_RECORDED_CONSENT` — `SMS_BRIDGE`;
3. детерминированная SMS, mock-SMS приняла — `SENT`;
4. аудит `SMS_BRIDGE / WHATSAPP_NO_RECORDED_CONSENT`;
5. открытие ссылки через публичный эндпоинт — `302
   https://wa.me/77272500100?text=…`, заголовки безопасности.

Проверено:
- WhatsApp-сообщений и WhatsApp-доставок 0;
- AI не вызывался (ловушки);
- клиенты, автомобили, заявки, записи не созданы;
- входящих сообщений и AI-ходов нет;
- согласий 0, сессия не открылась;
- клик учтён (`openCount 1`);
- в URL нет номера, тенанта, бизнеса, звонка и подключения;
- в БД только хэш токена.

### 32. Vertical slice #2

Записанное `OPTED_IN` (`CUSTOMER_OPT_IN_MESSAGE`) и одобренный шаблон —
WhatsApp, `MISSED_CALL_RECOVERY_V1`, причина `WHATSAPP_TEMPLATE_AVAILABLE`.
SMS-сообщений, SMS-доставок и ссылок 0.

### 33. Vertical slice #3

Нет WhatsApp и SMS (только Telegram) — `FAILED NO_ELIGIBLE_CHANNEL`,
причина `WHATSAPP_NOT_CONFIGURED|SMS_NOT_CONFIGURED`. Диалогов, сообщений и
доставок 0, `recoverySentAt = null`, ложного `SENT` нет. Очередь повторит в
пределах лимита MCR-4.

### 34. Tenant isolation

- Каналы, согласия и окно ищутся в пределах тенанта и бизнеса.
- Ссылка ищется только по хэшу; бизнес назначения — бизнес ссылки.
- Тест AB: согласие тенанта 1 для того же номера не разрешает WhatsApp
  тенанту 2 — у него SMS через его `sms-2`, и ссылка тоже тенанта 2.
- Тест L / Q: токен тенанта 2 ведёт только на номер тенанта 2. Без номера —
  отказ, а не номер тенанта 1.

### 35. UI changes

**Settings → Channels:**
- карточка «Восстановление пропущенных звонков»: «WhatsApp: подключён /
  не подключён / подключён, но не указан номер WhatsApp для клиентов»,
  «SMS для восстановления: подключены / не подключены» и одна фраза о
  порядке «WhatsApp, когда разрешено, иначе SMS со ссылкой»;
- тип канала `SMS`;
- в редактировании WhatsApp — поле «Номер WhatsApp для клиентов» (проверка
  E.164, остальной `config` сохраняется);
- устаревшая фраза «AI не отвечает автоматически ни в одном канале»
  исправлена.

**Conversation Detail** — секция «Восстановление звонка»:
- «Канал восстановления: SMS со ссылкой на WhatsApp»;
- «Причина: WhatsApp пока недоступен для первого сообщения — нет согласия
  клиента»;
- «Клиент открыл ссылку · …» / «Ссылку ещё не открывали».

Сырые коды не показываются (`recoveryReasonText`). Данные — `recovery` в DTO
диалога. Канал `SMS` получил подпись и иконку.

Согласие в UI не показывается и не редактируется (§31).

**Визуальная проверка (desktop / 390px) не выполнена:** браузерные
инструменты в этой сессии отключены. Проверено typecheck, сборкой и
юнит-тестами логики подписей. Новые элементы — текстовые блоки в
существующих карточках и колонках, без новых сеток.

### 36. MCR-4 regression

`callRecovery.test.ts` зелёный. Тесты переведены на **разрешённый**
WhatsApp-путь: у звонящего записанное согласие, у подключения одобренный
шаблон — это и есть смысл MCR-4 «восстановление, когда WhatsApp разрешён».
Проверка формы ответа маршрутизатора обновлена под новое решение.

**Это намеренное изменение поведения MCR-4:** раньше mock-WhatsApp писал
любому пропустившему звонок.

### 37. MCR-4.1 regression

`recoveryQueue.test.ts` зелёный, с теми же фикстурами разрешённого
WhatsApp. `vercel.json` получил `rewrites` для `/r/:token`; триггеры очередей
не тронуты (тесты конфигурации зелёные).

### 38. MCR-5 regression

`aiConversation.test.ts` зелёный (44 / 44). Фикстуры разрешённого WhatsApp
для сквозного сценария восстановления; поведение AI не менялось.

SMS не входит в `AI_AUTO_REPLY_CHANNELS`, входящие SMS отклоняются (тест
AF), клик ничего не создаёт — AI запускается только настоящим входящим.

Prompt 53 / 55 / 56 (`aiDraftMode`, `aiConversationDraft`,
`requestQualification*`, `requestBooking*`) зелёные.

### 39. Tests before / after

| | Количество |
|---|---|
| До | **1986 / 1986**, 90 файлов |
| Добавлено | **+28** — `tests/recoveryRouting.test.ts` (A–AC и три сквозных сценария) |
| После | **2014 / 2014**, 91 файл |

Изменены существующие тесты:
- `callRecovery`, `recoveryQueue`, `aiConversation` — мок репозитория
  маршрутизации (согласие OPTED_IN), шаблон в фикстурах, форма ответа
  маршрутизатора;
- `channel.schemas.test.ts` — «неверный тип» был `SMS`, теперь `FAX`, потому
  что SMS стал допустимым.

Мутационная проверка:
- UNKNOWN-согласие как разрешение — падает 11 тестов;
- игнорировать срок ссылки — падает тест J / K.

### 40. Typecheck / build / Prisma

- `npm run typecheck` — без ошибок.
- `npm run build` — успешно; предупреждение о размере чанка было и раньше.
- `prisma validate` — valid.
- `migrate status` — up to date, 23 миграции.
- `prisma format --check` не трогался.

### 41. Mock vs real providers

Всё mock:
- SMS — `createMockAdapter('SMS')`, без сети;
- WhatsApp — mock-адаптер, «одобренные шаблоны» из `config.approvedTemplates`;
- телефония — mock-вебхук;
- AI в MCR-6 не участвует.

Реальных SMS, WhatsApp, Meta, Twilio, Mobizon, Bird и телефонии нет. Реальный
Vercel (rewrite `/r/`, очереди) не проверялся.

### 42. Known limitations

- **Визуальная проверка UI** не выполнена (§35).
- **Rewrite `/r/:token`** проверен локально (vite) и тестом обработчика, но
  не на реальном Vercel.
- **Длина `APP_URL`.** Длинный адрес даёт третий сегмент SMS.
- **`whatsappInboundAt`** не связывается (нет реального WhatsApp-входящего,
  MCR-7).
- **Автоматического отзыва ссылок нет** — есть только срок и метод `revoke`.
- **Rate-limit моста нет** (полагаемся на энтропию и проверку формата).
- **SMS-диалог отдельный.** SMS-сообщение лежит в отдельном SMS-диалоге;
  ответ клиента в WhatsApp откроет WhatsApp-диалог. Связь между ними —
  через звонок и номер, общего треда нет.
- **Согласие только через код.** Записать его можно только кодом / будущим
  вебхуком (`channelConsentRepository.record`); API и UI нет — сознательно
  (§31). Источник STOP / opt-in — MCR-7.
- **Сессия по времени провайдера.** Окно считается по `Message.createdAt` —
  это время отправки, которое сообщил провайдер.
- **Поведение mock-WhatsApp изменилось.** Без согласия или сессии WhatsApp
  больше не используется. В production mock и так выключен.
- **Двусторонних SMS нет.**

### 43. MCR-7 readiness

Движок восстановления переписывать не нужно.

| Провайдер | Что потребуется |
|---|---|
| Реальный SMS | адаптер `ChannelType.SMS`: `businessInitiatedCapability` (конфигурация / доступность), `sendMessage` с `idempotencyKey`, вебхук статусов доставки |
| Реальный WhatsApp | адаптер `WHATSAPP`: техническая возможность, `recoveryTemplateAvailable` (одобренные шаблоны провайдера и сопоставление `MISSED_CALL_RECOVERY_V1`), `sendMessage` (шаблон вне сессии), входящий вебхук → существующий `receiveIncoming` (открывает окно и запускает MCR-5), вебхук статусов, запись opt-in / opt-out через `channelConsentRepository.record` |

Граница, которая остаётся: выбор шаблона против свободного текста внутри
адаптера WhatsApp, хранение учётных данных и подписи вебхуков.

### 44. Files changed

**Новые:**
- `src/server/recovery/bridge.ts`;
- `src/server/repositories/recoveryRoutingRepository.ts`;
- `src/server/lib/smsSegments.ts`;
- `api/bridge/[token].ts`;
- `src/components/conversations/recoveryRoute.ts`;
- `src/components/channels/recoverySetup.ts`;
- миграция `20261007120000_recovery_channel_routing`;
- `tests/recoveryRouting.test.ts`;
- `docs/prompts/mcr-6.md`, этот отчёт.

**Изменённые:**
- `prisma/schema.prisma`, `vercel.json`, `vite.config.ts`, `.env.example`;
- `src/server/recovery/{channelRouter, policy, templates}.ts`;
- `src/server/services/{callRecoveryService, channelConnectionService}.ts`;
- `src/server/channels/{types, channelAdapterRegistry, adapters/mockAdapter}.ts`;
- `src/server/repositories/conversationRepository.ts`, `src/server/lib/{dto, env}.ts`;
- UI: `ConversationDetailPanel.tsx`, `conversations/shared.ts`,
  `ChannelsSettingsPage.tsx`;
- тесты (§39);
- документация: `PRODUCT_BLUEPRINT.md`, аудит.

### 45. Git result

Один коммит `feat: add recovery channel routing and sms bridge`. Он запушен
в `origin/master` без force; локальный `master` совпадает с `origin/master`,
рабочее дерево чистое. Хэш — в итоговом сообщении.

---

### 46. Answers A–G

**A — новый звонящий без согласия, SMS настроена: выбирается SMS, а не
WhatsApp? YES.**
- UNKNOWN даёт `NO_RECORDED_CONSENT`, `initiationPermitted = false`, затем
  `SMS_BRIDGE` (тесты A / B / F, сквозной #1);
- WhatsApp-сообщений и доставок 0;
- мутация «UNKNOWN = разрешение» роняет 11 тестов.

**B — безопасная ссылка в один тап на WhatsApp нужного сервиса без номера и
id? YES.**
- `/r/<22 символа>`, 128 случайных бит, в БД только SHA-256;
- в URL нет номера, тенанта, бизнеса, звонка (тест I);
- переход на `wa.me` с номером **этого** бизнеса (тесты P / L / Q).

**C — клик ставит согласие или создаёт фальшивое входящее? NO.** Клик меняет
только `openCount` / `firstOpenedAt` / `lastOpenedAt`:
- согласий 0, входящих сообщений 0, AI-ходов 0;
- сессия WhatsApp не открывается — маршрутизатор после клика по-прежнему
  выбирает SMS / `NO_RECORDED_CONSENT` (тесты N / O, сквозной #1).

**D — WhatsApp действительно разрешён и доступен: выбирается WhatsApp без
SMS? YES.** Сквозной #2 (OPTED_IN + шаблон) и тест сессии (`SESSION_OPEN`):
SMS 0.

**E — могут ли повторы и параллельные обработчики отправить и WhatsApp, и
SMS? NO.**
- один захват, unique сообщение и ссылка;
- маршрут закреплён при создании сообщения;
- после попытки перемаршрутизации нет;
- при `DELIVERY_UNCERTAIN` запасного пути нет.

Тесты U, V, гонка с согласием, Y / AA, Z.

**F — MCR-5 запускается только настоящим входящим, а не кликом? YES.**
- Ход AI создаётся только в `receiveIncoming` для канала WhatsApp при
  включённом выключателе;
- мост сообщений не создаёт;
- входящие SMS отклоняются (тест AF);
- тесты MCR-5 зелёные.

**G — можно ли подключить реальные SMS и WhatsApp без переписывания движка?
YES.**
- Движок и маршрутизатор работают с `ChannelType` и контрактом адаптера
  (`businessInitiatedCapability`, `recoveryTemplateAvailable`, `sendMessage`
  с `idempotencyKey`), а не с провайдерами;
- согласие и окно не зависят от провайдера.

Остаётся работа адаптеров (§43): учётные данные, вызовы API, подписи и
вебхуки, сопоставление шаблонов, источник событий согласия.
