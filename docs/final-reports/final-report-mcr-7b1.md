## Final Report — MCR-7B1: Production WhatsApp Transport (Twilio Pilot)

WhatsApp теперь может работать через **настоящий Twilio Messages API**.
Основной сценарий пилота:

    пропущенный звонок → SMS (Mobizon) → /r/<token> → клиент сам пишет в WhatsApp
    → подписанный вебхук Twilio → сообщение в диалоге → MCR-5 AI (в очереди)
    → ответ через Twilio → статус «доставлено» / «прочитано»

Главное:
- Вебхук Twilio проверяется по `X-Twilio-Signature` **до любой записи**.
- Бизнес определяется **только** по номеру-получателю `To`. Номер связан с
  одним активным подключением уникальным `routingKey`. Никакие
  tenantId / businessId из запроса не читаются.
- Повтор вебхука с тем же `MessageSid` даёт одно сообщение и один ответ AI.
- 24-часовое окно открывается только настоящим входящим сообщением клиента.
  Звонок, SMS и клик по ссылке его не открывают. Свободный текст вне окна не
  отправляется ни AI, ни сотрудником.
- Потерянный ответ Twilio — это `DELIVERY_UNCERTAIN`: без повтора, без
  повторной генерации AI, без SMS.
- Без учётных данных Twilio WhatsApp недоступен. В production больше нет
  тихой подмены на mock.

**Реальных WhatsApp-сообщений не отправлялось**: учётных данных Twilio нет,
все тесты идут через подменённый HTTP.

Embedded Signup (MCR-7B2) и MCR-8 не начинались.

---

### 1. Baseline

`fdf206b feat: add production mobizon sms transport`. Проверено до изменений:
- ветка `master`;
- `HEAD` совпадает с `origin/master`;
- рабочее дерево чистое;
- тесты 2054 / 2054.

Прочитаны `PRODUCT_BLUEPRINT.md`, аудит, отчёты MCR-6 и MCR-7A. Изучены
`ChannelAdapter`, mock WhatsApp, `ChannelConnection`, маршрутизатор MCR-6,
`receiveIncoming`, триггер MCR-5, вебхуки Telegram и Mobizon. Существенных
расхождений нет.

### 2. Изменённые файлы

Новые:
- `src/server/channels/adapters/twilio/twilioClient.ts` — HTTP-вызов Messages API (таймаут, abort, ограничение ответа 64 КБ).
- `src/server/channels/adapters/twilio/twilioWhatsAppAdapter.ts` — адаптер, классификация ответа, разбор входящего.
- `src/server/channels/adapters/twilio/twilioSignature.ts` — подпись Twilio и ограниченный разбор формы.
- `src/server/channels/whatsappTransport.ts` — выбор адаптера по подключению, URL вебхуков, статус для настроек.
- `src/server/channels/customerServiceWindow.ts` — единая политика 24-часового окна.
- `src/server/channels/providerWebhookContext.ts` — серверный контекст для вебхука провайдера.
- `src/server/services/twilioWebhookService.ts` — входящие сообщения и статусы.
- `src/server/services/twilioConnectionService.ts` — подключение и отключение отправителя.
- `api/webhooks/channels/twilio/inbound.ts`, `api/webhooks/channels/twilio/status.ts`.
- `api/channels/[id]/twilio/connect.ts` (POST / DELETE), `api/channels/whatsapp-transport.ts` (GET).
- `prisma/migrations/20261009120000_twilio_whatsapp_transport/migration.sql`.
- `tests/twilioWhatsApp.test.ts` (36 тестов).
- `docs/prompts/mcr-7b1.md`, этот отчёт.

Изменённые:
- `prisma/schema.prisma`, `src/server/lib/env.ts`;
- `channels/types.ts`, `channels/deliveryStatus.ts`, `channels/channelAdapterRegistry.ts`;
- `recovery/channelRouter.ts`, `recovery/bridge.ts`;
- `services/channelDeliveryService.ts`, `services/channelMessageService.ts`, `services/callRecoveryService.ts`, `services/channelConnectionService.ts`;
- `repositories/channelConnectionRepository.ts`, `repositories/recoveryRoutingRepository.ts`;
- `lib/dto.ts`;
- `ChannelsSettingsPage.tsx`, `components/channels/recoverySetup.ts`, `components/conversations/aiAutomation.ts`;
- `tests/tenantIsolation.test.ts`;
- `.env.example`, `PRODUCT_BLUEPRINT.md`, аудит.

### 3. Схема и миграция

Миграция `20261009120000_twilio_whatsapp_transport` только добавляет поля:

| Изменение | Назначение |
|---|---|
| `ChannelConnection.provider String?` | провайдер (`twilio`); `null` = mock / Telegram как раньше |
| `ChannelConnection.senderE164 String?` | номер-отправитель WhatsApp |
| `ChannelConnection.routingKey String? @unique` | `WHATSAPP:twilio:+E164`, только пока подключение ACTIVE |
| `ProviderDeliveryState` + `READ` | статус «прочитано» |
| `RecoveryBridgeLink.whatsappInboundAt DateTime?` | атрибуция настоящего входящего к звонку и ссылке |

Уже применённые миграции не менялись. Существующие строки получили `NULL`.

### 4. Twilio API

Всё проверено по официальной документации Twilio:
- `POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json`
  (form-urlencoded) с полями `To`, `From` (`whatsapp:+E164`), `Body` **или**
  `ContentSid` + `ContentVariables`, и `StatusCallback`;
- входящий вебхук: `MessageSid`, `AccountSid`, `From`, `To`, `Body`,
  `NumMedia`, `MediaContentType0`, `ProfileName`, `WaId`,
  `Latitude` / `Longitude`;
- статусный вебхук: `MessageSid`, `MessageStatus`, `ErrorCode`, а для
  прочтения `EventType=READ`.

### 5. Аутентификация

- Исходящие запросы: HTTP Basic `AccountSid:AuthToken`.
- Вебхуки: `X-Twilio-Signature` = base64(HMAC-SHA1(AuthToken, полный URL +
  отсортированные пары «ключ + значение» POST-параметров)). Это
  документированный алгоритм Twilio, не самодельный HMAC. Сравнение идёт за
  постоянное время.

### 6. Архитектура адаптера

`getChannelAdapter(type, connection)`:
- для WhatsApp вызывает `whatsappAdapterFor(connection)`;
- подключение с `provider='twilio'`, учётными данными и номером получает `TwilioWhatsAppAdapter`;
- в остальных случаях адаптер недоступен (в production) или mock (вне production).

Движок восстановления и MCR-5 не импортируют ничего из Twilio. Будущий
`MetaCloudWhatsAppAdapter` подключается в той же точке.

Адаптер объявляет `freeFormRequiresOpenSession`. Ядро доставки само
проверяет окно перед отправкой свободного текста.

### 7. Модель учётных данных пилота

Один аккаунт Twilio, которым управляет AUTOSERVISE. В переменных окружения
сервера:
- `TWILIO_ACCOUNT_SID`;
- `TWILIO_AUTH_TOKEN`;
- `TWILIO_WHATSAPP_SENDERS` — список «+E164=<businessId>»;
- `TWILIO_TEMPLATE_MISSED_CALL_RECOVERY_V1` (необязательно).

Секреты не хранятся в БД, не попадают во фронтенд и не пишутся в логи.
Если учётных данных нет, Twilio недоступен.

### 8. Привязка отправителя к бизнесу

- Номер-отправитель назначает **сервер** через `TWILIO_WHATSAPP_SENDERS`.
  Владелец или админ не вводит номер — он только нажимает «Подключить
  Twilio».
- Номер, назначенный другому бизнесу, подключить нельзя.
- `routingKey @unique`: один номер не может быть активен в двух бизнесах.
  Конфликт возвращает 409 `SENDER_ALREADY_CONNECTED`.
- Если бизнесу номер не назначен, ответ 409 `NO_ASSIGNED_SENDER`.
- При отключении (`DELETE`) или деактивации `routingKey` сбрасывается.

### 9. Входящий вебхук

`POST /api/webhooks/channels/twilio/inbound`. Отвечает пустым TwiML
`<Response/>` сразу после записи. OpenAI в запросе не вызывается — AI
работает в очереди `ai-conversation-reply`.

### 10. Проверка подписи

- URL берётся из канонического `APP_URL` плюс query из запроса. Заголовкам
  Host / X-Forwarded-* не доверяем. В production нужен https и
  не-localhost.
- Если нет AuthToken или URL — 503: неподписанное никогда не принимается.
- Неверная или отсутствующая подпись, изменённый параметр, другой URL или
  другой токен — 403, ничего не записывается.
- Чужой `AccountSid` — 403.
- Тело ограничено: не больше 200 ключей, значения до 20 000 символов.

### 11. Входящая маршрутизация

`To` → `+E164` → `routingKey` → единственное ACTIVE-подключение → бизнес →
тенант.

Неизвестный номер-получатель: ответ 200 `UNKNOWN_SENDER`. Ничего не
записывается, AI не запускается, сведений о тенантах в ответе нет. Поле
`routingKey` уникально, поэтому совпасть с двумя подключениями нельзя.

### 12. Нормализация From / To

Префикс `whatsapp:` снимается, номер нормализуется утилитой MCR-1
`normalizePhone`.
- Входящее: `From` — клиент, `To` — мастерская.
- Исходящее: `From` — `senderE164` подключения, `To` — канонический номер
  диалога. Номер из браузера никогда не используется как адресат.

### 13. Идемпотентность по MessageSid

`receiveIncoming` использует уже существующую уникальность
`ChannelMessage (channelConnectionId, externalMessageId)`. Если `MessageSid`
уже записан на **другом** подключении, ответ `SID_CONFLICT`: сообщение не
маршрутизируется второй раз.

### 14. Поиск диалога

Существующий конвейер: диалог ищется по паре (подключение, номер клиента),
иначе создаётся. Второй конвейер не создавался.

### 15. Связь с клиентом

Правила Prompt 54 / MCR-1:
- ровно один активный клиент с этим номером — диалог связывается с ним;
- несколько — диалог остаётся без связи;
- ни одного — `customerId = null`.

Клиенты не создаются и не объединяются.

### 16. Атрибуция SMS-ссылки

`attributeWhatsAppInbound` ищет в бизнесе незакрытые, неистёкшие и ещё не
атрибутированные ссылки, у которых номер звонящего совпадает с `From`.
- Ровно одна такая ссылка — `whatsappInboundAt` ставится через
  compare-and-set.
- Две и больше — `AMBIGUOUS`, ничего не ставится.

Диалог при этом не блокируется. Повтор вебхука атрибуцию не повторяет.

### 17. Окно обслуживания

`isWhatsAppSessionOpen(scope, номер, now)` в `customerServiceWindow.ts` —
единственное место с правилом 24 часов. Окно открыто, если
`now < последнее настоящее входящее + 24 ч`; ровно на границе 24 ч окно уже
закрыто. Маршрутизатор MCR-6 использует ту же функцию.

Звонок, SMS и клик по ссылке входящих сообщений не создают, поэтому окно
не открывают. Это проверено тестами.

### 18. Согласие

- Входящее сообщение не создаёт и не меняет `ChannelConsent`. Окно и
  согласие хранятся раздельно.
- Записанный `OPTED_OUT` остаётся в силе для инициативных сообщений бизнеса.
  Входящее сообщение клиента всё равно сохраняется, и на него можно
  ответить в пределах окна.
- Повторное согласие в продукте пока не определено, поэтому автоматически
  ничего не переписывается.

### 19. Триггер MCR-5

Тот же `receiveIncoming`: ход `AiConversationTurn` и задание
`ai-conversation-reply` содержат только id хода — без PII. Для сообщений
без текста (вложение, геолокация) ход не создаётся.

### 20. Исходящий ответ AI

Потребитель очереди MCR-5 → `deliverSystemMessage` →
`getChannelAdapter(connection)` → Twilio. Защиты MCR-5 сохранены:
- выключатель (kill switch);
- пауза сотрудником;
- передача диалога человеку (handoff);
- лимит авто-ответов;
- ответы о ценах и адресе опираются только на данные бизнеса;
- свободное время только читается;
- никаких автозаписей.

### 21. Ответ сотрудника

Обычный composer → тот же `attemptDelivery` → тот же адаптер Twilio. После
ответа сотрудника AI ставится на паузу (`HUMAN_TAKEOVER`). Заходить в
Twilio Console не нужно.

### 22. Инициативный шаблон

`MISSED_CALL_RECOVERY_V1` → `ContentSid` из
`TWILIO_TEMPLATE_MISSED_CALL_RECOVERY_V1`, переменная `{"1": название
бизнеса}`.
- Шаблон используется только когда маршрутизатор закрепил WHATSAPP с
  причиной `WHATSAPP_TEMPLATE_AVAILABLE`.
- Если шаблона нет — `TEMPLATE_UNAVAILABLE`, запрос в Twilio не уходит.
- Свободный текст никогда не превращается в шаблон.
- UI для создания шаблонов не делался.

### 23. Статусный вебхук

`POST /api/webhooks/channels/twilio/status`, `StatusCallback` задаётся при
каждой отправке:
1. проверка подписи;
2. `eventId = sid:status:eventType` для идемпотентности;
3. поиск доставки только по сохранённой паре (`twilio`, `MessageSid`);
4. монотонное применение статуса.

### 24. Маппинг статусов

| Twilio | AUTOSERVISE |
|---|---|
| queued / accepted / scheduled / sending / sent | ACCEPTED |
| delivered | DELIVERED |
| read, `EventType=READ` | READ |
| undelivered / failed / canceled | UNDELIVERED |
| неизвестный | без изменения состояния; сырой статус сохраняется для наблюдения |

### 25. Монотонность

`canAdvanceDeliveryState`:
- конечные состояния (UNDELIVERED / EXPIRED / REJECTED / READ) не меняются;
- из DELIVERED возможен только переход в READ;
- в остальных случаях статус меняется только вперёд по рангу.

Поэтому «delivered → sent», «read → delivered» и «failed после delivered»
ничего не откатывают.

### 26. Вложения и геолокация

Сообщение без текста сохраняется с меткой «[Вложение: image/jpeg]» и не
отправляется в AI. Создаётся эскалация, AI ставится на паузу
(`UNSUPPORTED_MESSAGE`). Байты файлов не скачиваются.

Геолокация: сохраняется метка «[Клиент отправил геолокацию]», дальше — передача
человеку. Координаты не обрабатываются.

### 27. Неизвестный клиент

Диалог создаётся с `customerId = null`, AI отвечает по общим данным
бизнеса. Оператор позже связывает клиента через Prompt 54.

### 28. Передача человеку

Действует существующий handoff MCR-5. Новый случай — `UNSUPPORTED_MESSAGE`
для вложений и геолокации.

### 29. Таймаут

8 секунд, `AbortController`.
- Ошибка до отправки (DNS / соединение) — `NOT_SENT`, временная, можно
  повторить.
- Таймаут после отправки или 5xx — неопределённый результат.

### 30. DELIVERY_UNCERTAIN

Неопределённый ответ (таймаут, 5xx, 2xx без `sid`) даёт
`DELIVERY_UNCERTAIN`. Этот код не повторяется (`NON_RETRYABLE`), AI не
генерирует ответ заново, SMS не отправляется. Проверено тестом.

### 31. Идемпотентность у провайдера

У Messages API **нет документированного ключа идемпотентности** для
исходящих сообщений. Поэтому его не придумывали: двойную отправку
предотвращает `DELIVERY_UNCERTAIN`.

Twilio может повторить вебхук один раз (при ошибке соединения). Заголовок
`I-Twilio-Idempotency-Token` существует, но для статусов используется свой
`eventId`, а для входящих — `MessageSid`. Этого достаточно.

Безопасно повторяются только 429 / 20429. Код 63016 (вне окна) превращается
в `WHATSAPP_SESSION_CLOSED`, код 21211 — в `INVALID_DESTINATION`.

### 32. Приватность

- В логах только id, маскированный номер, тип сообщения и итог.
- Не логируются: AuthToken, тело вебхука, текст сообщения, полный номер,
  токен ссылки.
- Сырой ответ провайдера не сохраняется.
- Настройки показывают только маску номера.

### 33. Изоляция тенантов

- Бизнес определяется только по `To`.
- Контекст строится сервером из подключения.
- Все репозитории фильтруют по scope.
- `setStatus` сначала читает строку с фильтром по тенанту — тест
  `tenantIsolation` обновлён.

### 34. Сквозной сценарий

Тест `production-like vertical slice` прогоняет весь путь:
1. пропущенный звонок, consent UNKNOWN → SMS_BRIDGE через Mobizon (поддельный HTTP);
2. клик по `/r/<token>`;
3. подписанный входящий «Здравствуйте! Я только что звонил в автосервис.»;
4. сообщение попадает в правильный бизнес, окно открывается, ссылка атрибутирована;
5. создаётся задание MCR-5, mock AI отвечает;
6. ответ уходит через `TwilioWhatsAppAdapter` и получает SID;
7. статусный вебхук `delivered` → DELIVERED.

Проверено:
- согласие не создано;
- одно входящее и один ответ AI;
- не созданы Customer / Vehicle / Request / Appointment;
- правильный тенант и отправитель.

### 35. Дубликаты входящих

5 одновременных вебхуков с одним `MessageSid` дают одно сообщение, один ход
и один ответ AI.

### 36. Подмена тенанта

Отправитель `To` принадлежит бизнесу B, а в теле лежат tenantId / businessId
бизнеса A. Сообщение попадает только в B.

### 37. Тесты окна

Время в тестах внедряется:
- T0 — окно открыто;
- T0 + 23:59 — открыто;
- ровно T0 + 24 ч — закрыто;
- только звонок, SMS или клик — закрыто;
- свободный текст вне окна (AI и сотрудник) — FAILED `WHATSAPP_SESSION_CLOSED`, запроса в Twilio нет.

### 38. Регрессии MCR

Полный набор зелёный: MCR-4, 4.1, 5, 6, 7A, Prompt 53–56, изоляция.
Отдельно проверено:
- consent UNKNOWN → SMS;
- OPTED_IN без шаблона → SMS;
- OPTED_IN с шаблоном → шаблон Twilio, SMS нет.

Мутационная проверка:
- отключили проверку подписи — упали 5 тестов;
- отключили проверку окна — упал 1 тест;
- код восстановлен.

### 39. Количество тестов

2054 → **2090** (+36), 93 файла, все проходят.

### 40. Typecheck

`tsc` без ошибок.

### 41. Build

Production build `vite build` успешен.

### 42. Prisma

`prisma validate` — OK. Известное ранее расхождение `prisma format --check`
в старой части схемы не трогали.

### 43. Supabase

Миграция применена через `prisma migrate deploy`. Всего 25 миграций,
`migrate status` — «up to date».

Проверено в живой БД:
- у 3 существующих подключений `provider` / `routingKey` = NULL;
- в enum есть `READ`.

### 44. UI / браузер

Settings → Channels показывает:
- провайдер Twilio, режим, маску номера;
- статус шаблона восстановления;
- для каждого WhatsApp-подключения: «Twilio · +7 *** ** 12 · сообщения
  клиентов принимаются»;
- кнопки «Подключить Twilio» / «Отключить Twilio».

Проверка в браузере (desktop и 390px) **не выполнялась**: браузерные
инструменты были недоступны. UI проверен только typecheck, сборкой и
юнит-тестами view-логики.

### 45. Реальное WhatsApp-сообщение

**НЕТ.** Учётных данных Twilio нет, Twilio не вызывался.

### 46. Чек-лист активации пилота

1. **Аккаунт Twilio.** Создать аккаунт и перевести его на платный тариф
   (Upgrade). Self Sign-up недоступен на trial.
2. **Meta.** Нужен Meta Business Portfolio (Business Manager) с доступом
   администратора. Без верификации бизнеса действует лимит —
   250 инициативных диалогов за 24 ч.
3. **Отправитель.** Twilio Console → Messaging → Senders → WhatsApp senders
   → Create new sender (Self Sign-up). Пройти вход в Facebook, создать или
   выбрать WABA, указать номер. Номер не должен быть уже зарегистрирован в
   WhatsApp или WhatsApp Business App.
4. **Подтверждение номера.** Ввести код (OTP) из SMS или звонка. Display
   name проходит проверку Meta.
5. **Ключи.** Console → Account Info: взять `Account SID` (AC…) и
   `Auth Token`.
6. **Входящий вебхук.** Senders → номер → Edit Sender → Webhook URL for
   incoming messages = `https://<APP_URL>/api/webhooks/channels/twilio/inbound`,
   метод POST.
7. **Статусный вебхук.** AUTOSERVISE сам передаёт `StatusCallback` =
   `https://<APP_URL>/api/webhooks/channels/twilio/status`. В Console можно
   указать тот же Status callback URL.
   **Оба URL должны в точности совпадать с `APP_URL`** (схема, хост, путь),
   иначе подпись не сойдётся и вебхуки получат 403.
8. **Связь с бизнесом.** В `TWILIO_WHATSAPP_SENDERS` указать
   `+77001234567=<businessId>`.
9. **Секреты в Vercel** (Production): `TWILIO_ACCOUNT_SID`,
   `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_SENDERS`, `APP_URL` (https).
   При наличии одобренного шаблона — `TWILIO_TEMPLATE_MISSED_CALL_RECOVERY_V1`
   (HX…).
10. **Деплой.** Задеплоить, затем в Settings → Channels у WhatsApp-канала
    нажать «Подключить Twilio» (владелец или админ). Статус должен стать
    «Twilio · маска · сообщения клиентов принимаются».
11. **Тестовое сообщение.** Со своего телефона написать на номер
    мастерской в WhatsApp.
12. **Проверка.** Сообщение появилось в «Диалогах», AI ответил в WhatsApp,
    у ответа статус «Доставлено», затем «Прочитано».

### 47. Ограничения пилота

- Один аккаунт Twilio на всех. Номера назначаются через env, а не через
  самостоятельное подключение.
- Embedded Signup, субаккаунты и управление шаблонами — в MCR-7B2.
- Доставку с `DELIVERY_UNCERTAIN` нельзя сопоставить со статусом, потому что
  SID неизвестен. Оператор видит её как неопределённую.
- `I-Twilio-Idempotency-Token` не используется.
- В production WhatsApp-подключение без провайдера теперь **недоступно**.
  Раньше mock «отправлял» сообщения в никуда.
- Вложения и геолокация всегда передаются человеку.
- Повторное согласие после `OPTED_OUT` не определено.
- Живой пропущенный звонок требует настоящей телефонии (MCR-8).

### 48. Готовность к MCR-7B2

Добавить Embedded Signup можно без переписывания Recovery Engine и MCR-5:
- `ChannelConnection.provider` / `senderE164` / `routingKey` уже
  провайдер-нейтральны;
- учётные данные субаккаунта подставляются в `whatsappAdapterFor`;
- назначение номера через env заменяется записью из онбординга.

### 49. Готовность к MCR-8

Цепочка от события `CallInteraction` до ответа AI в WhatsApp готова. MCR-8
нужен только источник настоящих пропущенных звонков (телефония).

### 50. Ответы A–L

| | Ответ | Основание |
|---|---|---|
| A | **YES** | маршрут только по `To` → `routingKey`; тест подмены тенанта |
| B | **YES** | `isWhatsAppSessionOpen` по настоящему входящему; тест T0 / 23:59 / 24 ч |
| C | **NO** | тест «звонок, SMS и клик окно не открывают» |
| D | **YES** | `receiveIncoming` → ход → `ai-conversation-reply`; сквозной тест |
| E | **YES** | сквозной тест: SID от Twilio, статус DELIVERED |
| F | **NO** | 5 одновременных дубликатов дают один ответ |
| G | **NO** | подпись проверяется до записи; мутационная проверка — 5 падений |
| H | **YES** | тест ответа сотрудника через тот же адаптер |
| I | **NO** | проверка окна в ядре доставки; запроса нет |
| J | **NO** | `DELIVERY_UNCERTAIN` не повторяется; тест |
| K | **YES** | регрессионный тест UNKNOWN → SMS_BRIDGE |
| L | **YES** | граница `ChannelAdapter` + провайдер-нейтральное подключение (п. 48) |

### 51. Git result

Один коммит `feat: add production twilio whatsapp transport`. Он запушен в
`origin/master` без force; локальный `master` совпадает с `origin/master`,
рабочее дерево чистое. Хэш — в итоговом сообщении.
