## Final Report — MCR-7A: Production SMS Transport (Mobizon Kazakhstan)

SMS восстановления пропущенного звонка теперь может уходить через
**настоящий API Mobizon Kazakhstan**.

- Адаптер стоит за той же границей `ChannelAdapter`, что и mock. Движок
  восстановления и маршрутизатор MCR-6 не менялись.
- Включается только явной настройкой сервера: `SMS_PROVIDER=mobizon` и
  ключ. Без этого SMS выключены — подмены на mock нет.
- Отчёты о доставке приходят на подписанный вебхук:
  1. подпись проверяется до любой записи;
  2. повторы отбрасываются по `eventId`;
  3. отчёт сопоставляется с нашей доставкой по сохранённому id сообщения;
  4. статус перечитывается из API Mobizon — подпись не покрывает данные
     отчёта;
  5. статус меняется только вперёд, никогда назад.
- Если ответ Mobizon потерян (таймаут), SMS **не отправляется повторно** и не
  дублируется WhatsApp: это `DELIVERY_UNCERTAIN`. У Mobizon нет ключа
  идемпотентности.

**Реальных платных SMS не отправлялось**: учётных данных нет, все тесты идут
через подменённый HTTP.

---

### 1. Baseline

`6033f17 feat: add recovery channel routing and sms bridge`. Проверено до
изменений:
- ветка `master`;
- `origin/master` совпадает;
- рабочее дерево чистое;
- тесты 2014 / 2014.

### 2. Files changed

**Новые:**
- `src/server/channels/adapters/mobizon/{mobizonClient, mobizonSmsAdapter, mobizonWebhook}.ts`;
- `src/server/channels/{smsTransport, deliveryStatus}.ts`;
- `src/server/repositories/smsDeliveryReportRepository.ts`;
- `src/server/services/smsDeliveryReportService.ts`;
- `api/webhooks/channels/mobizon.ts`, `api/channels/sms-transport.ts`;
- `src/components/conversations/deliveryLabel.ts`;
- миграция `20261008120000_mobizon_sms_transport`;
- `tests/mobizonSms.test.ts`;
- `docs/prompts/mcr-7a.md`, этот отчёт.

**Изменённые:**
- `prisma/schema.prisma`, `.env.example`;
- `src/server/lib/{env, dto}.ts`;
- `src/server/channels/{types, channelAdapterRegistry, adapters/mockAdapter}.ts`;
- `src/server/repositories/channelDeliveryRepository.ts`;
- `src/server/services/{channelDeliveryService, callRecoveryService, aiConversationService}.ts`;
- `src/server/recovery/{templates, bridge, policy}.ts`;
- UI: `ConversationDetailPanel.tsx`, `conversations/shared.ts`,
  `ChannelsSettingsPage.tsx`, `channels/recoverySetup.ts`;
- `tests/channelDeliveryService.test.ts` — у `markSent` новый аргумент
  `provider`;
- документация: `PRODUCT_BLUEPRINT.md`, аудит.

### 3. Schema / migration

Только добавления, без переформатирования старых блоков.

| Изменение | Назначение |
|---|---|
| `ChannelDelivery.provider` | `"mobizon"` / `"mock"` |
| `ChannelDelivery.providerDeliveryState` (`ProviderDeliveryState`: `ACCEPTED`, `PARTIALLY_DELIVERED`, `DELIVERED`, `UNDELIVERED`, `EXPIRED`, `REJECTED`) | доставка оператором после принятия |
| `ChannelDelivery.providerStatus` | сырой код Mobizon, только для отладки |
| `ChannelDelivery.providerStatusAt`, `providerSegments` | время отчёта, сегменты |
| `@@index([provider, externalMessageId])` | поиск доставки по отчёту |
| модель `ProviderWebhookEvent` (`provider`, `eventId`, `channelDeliveryId`, `outcome`, `receivedAt`), `@@unique([provider, eventId])` | идемпотентность вебхука; без payload и без PII |
| CHECK `providerSegments` > 0 или NULL | — |

`ChannelDelivery.status = SENT` по-прежнему означает «провайдер принял», а
доставка — отдельное поле. id сообщения Mobizon хранится в существующем
`externalMessageId`.

### 4. Mobizon API endpoint used

По официальной документации (mobizon.kz/help/api-docs, проверено 2026-10-04):

| Назначение | Запрос | Ответ |
|---|---|---|
| Отправка | `POST https://api.mobizon.kz/service/Message/SendSmsMessage?output=json&api=v1&apiKey=…` | `{ code: 0, data: { campaignId, messageId, status }, message }` |
| Статус | `POST https://api.mobizon.kz/service/Message/GetSMSStatus` (`ids`) | `[{ id, status, segNum, startSendTs, statusUpdateTs }]` |

Параметры отправки: `recipient` (только цифры, международный формат), `text`,
`from`, `params[shortenLinks]=0`. Тело —
`application/x-www-form-urlencoded; charset=utf-8`.

Коды ответа API: 0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 30
(лимит запросов), 98, 99, 100, 999.

**Отличия от предположений промпта:**
- Ключ передаётся в query-строке — так в документации. Поэтому URL запросов
  нигде не логируются.
- `params[validity]` не используется.

### 5. Authentication method

Параметр `apiKey` в строке запроса — документированный способ Mobizon. Других
схем нет.

### 6. Adapter architecture

```
Recovery Engine → deliverSystemMessage → getChannelAdapter('SMS') → smsTransport.smsAdapter()
                                                                     ├ MobizonSmsAdapter   (SMS_PROVIDER=mobizon + полная конфигурация)
                                                                     ├ mock                (SMS_PROVIDER=mock / не задан, только не production)
                                                                     └ unavailable         (всё остальное — закрыто)
```

- Движок, маршрутизатор и ядро доставки Mobizon не импортируют.
- В контракт адаптера добавлены `provider` и исход `uncertain`.
- Другой SMS-провайдер — новый адаптер плюс строка в `smsTransport`.

### 7. Credentials

Переменные окружения сервера, все без значений в `.env.example`:

| Переменная | Назначение |
|---|---|
| `SMS_PROVIDER` | `mobizon` / `mock` |
| `MOBIZON_API_KEY` | ключ API |
| `MOBIZON_API_BASE_URL` | необязательна; по умолчанию `https://api.mobizon.kz`; допускается только `https://api.mobizon.<tld>` без порта и пути — защита от SSRF |
| `MOBIZON_SENDER` | необязательна |
| `MOBIZON_WEBHOOK_SECRET` | секрет вебхука |
| `RECOVERY_LINK_BASE_URL` | необязательна |

Ключ и секрет никогда не возвращаются клиенту. `/api/channels/sms-transport`
отдаёт только провайдера, режим, «настроен», отправителя и «вебхук
подключён» — это проверено тестом. В `.env` переменных Mobizon нет.

### 8. Multi-tenant boundary

Пилот — **один аккаунт Mobizon, принадлежащий AUTOSERVISE** (окружение
сервера). Он используется для любого бизнеса с ACTIVE SMS-подключением
(MCR-6).

- Бизнес и номер получателя всегда берутся из `CallInteraction` и диалога:
  тред = цифры канонического E.164 звонящего.
- Ни клиент, ни провайдер не выбирают тенанта.
- Отчёт о доставке находит строку **только** по `(provider, messageId)`.

Учётные данные на каждый бизнес позже — это выбор конфигурации в
`smsTransport` по подключению, без изменения движка.

### 9. Sender model

`MOBIZON_SENDER` — альфа-имя аккаунта AUTOSERVISE: общее или
зарегистрированное. Если не задано — отправитель аккаунта по умолчанию.

В Settings это явно «общий отправитель AUTOSERVISE, не собственное имя вашего
автосервиса» (`senderScope: SHARED_ACCOUNT`). Собственный брендированный
отправитель автосервиса **не** заявляется.

### 10. Outbound request

Пример запроса:

```
recipient=77011234567
text=Вы звонили в «Автосервис Тест», мастер был занят. Продолжим в WhatsApp: https://…/r/<22>
from=AUTOSERVISE
params[shortenLinks]=0
```

- Получатель — цифры канонического E.164 из треда. Неверный, анонимный или
  пустой номер не отправляется (`INVALID_DESTINATION`, запросов 0 — тест).
- Явный `shortenLinks=0` не даёт сокращателю Mobizon подменить нашу
  ссылку `/r/`.

### 11. Response mapping

| Исход | Когда | Результат |
|---|---|---|
| ACCEPTED | `code 0` и `data.messageId` | `success`, id сохраняется |
| REJECTED | `code` 1 / 11 / 12 | `SMS_REJECTED`, не повторяется |
| PERMANENT | `code` 8 / 9 / 13 / 14 | `PROVIDER_AUTH_ERROR` |
| PERMANENT | прочий 4xx, неизвестный код | `PROVIDER_ERROR` |
| TRANSIENT | `code 30`, HTTP 429 | `PROVIDER_RATE_LIMITED` |
| TRANSIENT | `code` 3 / 10 / 15 / 999, соединение не установлено (`ECONNREFUSED`, `ENOTFOUND`) | `PROVIDER_TRANSIENT_ERROR`, повторяется |
| UNCERTAIN | таймаут, разрыв после отправки, 5xx без ответа API, `code 0` без `messageId`, `code 100`, нечитаемый ответ | `DELIVERY_UNCERTAIN`, не повторяется |

`SMS_REJECTED` и `INVALID_DESTINATION` добавлены в
`NON_RETRYABLE_FAILURE_CODES` (MCR-4).

### 12. Provider message ID

`data.messageId` записывается в `ChannelDelivery.externalMessageId` вместе с
`provider = "mobizon"`, в момент `SENT`. Полный ответ провайдера не хранится.

### 13. Timeout

- Отправка — `AbortController`, 8 с (`MOBIZON_SEND_TIMEOUT_MS`).
- Запрос статуса — 3 с: вебхук должен ответить Mobizon в течение 5 с.
- Ответ ограничен 64 КБ.

Таймаут даёт `UNKNOWN` / `TIMEOUT`, затем UNCERTAIN — тест с настоящим abort.

### 14. Idempotency

**У Mobizon `SendSmsMessage` нет ключа идемпотентности, client reference или
внешнего id** — это проверено по документации, придумывать мы ничего не
стали.

Защита — на нашей стороне:
- атомарный захват звонка (MCR-4);
- захват доставки `PENDING / FAILED → SENDING` (compare-and-set);
- одно сообщение на звонок;
- закреплённый маршрут (MCR-6);
- неоднозначный исход не повторяется.

### 15. DELIVERY_UNCERTAIN

Неоднозначный исход:
- доставка **остаётся `SENDING`** с кодом `DELIVERY_UNCERTAIN`;
- любой следующий захват видит IN_PROGRESS;
- звонок получает `FAILED DELIVERY_UNCERTAIN` (не повторяемый);
- staff-путь отвечает 409.

Тест «неопределённость»: ровно 1 запрос к Mobizon, повторные доставки из
очереди — `SKIPPED`, WhatsApp-сообщений 0. В UI — «Отправка не
подтверждена».

### 16. Retry policy

- **До принятия** (REJECTED / TRANSIENT): существующие правила MCR-4. `FAILED`
  с повторяемым кодом — повтор **того же** сообщения (тест: `code 30`, затем
  принято — тот же текст, `attemptCount` 2). Неповторяемые коды
  (`SMS_REJECTED`) не повторяются (тест).
- **После принятия** повторной отправки нет: статусы доставки не запускают
  ни SMS, ни WhatsApp.
- **Неопределённость** — без повторов (§15).
- Запасного пути в WhatsApp после попытки нет — политика MCR-6 сохранена.

### 17. Webhook endpoint

`POST /api/webhooks/channels/mobizon` (`api/webhooks/channels/mobizon.ts`).
Публичный, без сессии. Ответы: `{ ok }` и код:

| Код | Когда |
|---|---|
| 200 | принято или осознанно проигнорировано |
| 400 | неверный формат |
| 403 | подпись |
| 405 | не POST |
| 503 | нет секрета, статус недоступен, внутренняя ошибка — Mobizon повторит |

### 18. Webhook verification

По документации: `sign = SHA1(eventId|attempt|eventCreateTs|secretKey)`.
- Сравнение за постоянное время (`timingSafeEqualStrings`).
- Подпись проверяется **до любой записи**.
- Без `MOBIZON_WEBHOOK_SECRET` вебхук отклоняет всё (503). Неподписанные
  вебхуки не принимаются никогда, хотя Mobizon позволяет секрет не задавать.
- Формула проверена тестом на примере из документации.

**Ограничение протокола Mobizon:** подпись **не покрывает `data`**
(`messageId`, `status`, `to`). Поэтому после проверки подписи:
1. `data.to` должен совпасть с номером, на который мы отправляли — иначе
   `DESTINATION_MISMATCH`, игнор;
2. статус **перечитывается через `Message.GetSMSStatus`**, данным отчёта мы
   не доверяем.

Тест: отчёт говорит DELIVRD, API — UNDELIV, итог «Не доставлено».

### 19. Webhook idempotency

`ProviderWebhookEvent` уникален по `(mobizon, eventId)`. Строка события и
изменение состояния — одна транзакция. Повтор с тем же `eventId` (Mobizon
повторяет до 10 раз, `attempt` растёт) — `DUPLICATE`: без повторного запроса
статуса и без изменений (тест).

Если запрос статуса не удался — 503 **без строки события**, и повтор того же
`eventId` применится позже (тест). Отчёты не создают сообщений, событий
звонка, мостов и AI-ходов.

### 20. Delivery status mapping

`channels/deliveryStatus.ts`, по таблице Mobizon:

| Код Mobizon | Состояние |
|---|---|
| NEW / ENQUEUD / ACCEPTD | ACCEPTED |
| PDLIVRD | PARTIALLY_DELIVERED |
| DELIVRD | DELIVERED |
| UNDELIV / DELETED | UNDELIVERED |
| REJECTD | REJECTED |
| EXPIRED | EXPIRED |

Неизвестный код — `null`: сохраняется в `providerStatus` для наблюдения, но
состояние не меняется и «доставлено» не ставится (тест «BRANDNEW»).

### 21. Out-of-order protection

Ранги: ACCEPTED 1 < PARTIALLY_DELIVERED 2 < финальные 3. Состояние может
только расти; финальное больше не меняется — ни назад, ни на другое
финальное. Плюс compare-and-set по текущему состоянию.

Тест: DELIVRD → ACCEPTD → UNDELIV даёт DELIVERED и исходы `APPLIED`,
`NO_CHANGE`, `NO_CHANGE`.

### 22. SMS template before / after

Было (MCR-6): одна формулировка.

Стало: детерминированный выбор из вариантов, от самого полного к короткому —
**первый, дающий наименьшее число сегментов** для реальной ссылки:
1. `Вы звонили в «X», мастер был занят. Продолжим в WhatsApp: <url>`
2. `Вы звонили в «X». Напишите нам в WhatsApp: <url>`
3. `Вы звонили в «X». WhatsApp: <url>`

Название бизнеса **никогда не выкидывается**: при общем отправителе это
единственная подсказка, кто пишет. Без названия — «нам».

### 23. Character count

С `https://app.autoservise.test` и названием «Автосервис Тест»: **125 символов**.

| Часть | Символов |
|---|---|
| постоянный текст | 57 (включая `в «»`) |
| название | 15 (до 24, с «…») |
| URL: origin | 28 |
| URL: `/r/` | 3 |
| URL: токен | 22 (128 бит — не укорачивается) |

### 24. Encoding

UCS-2: кириллица. Транслитерации нет.

### 25. Estimated segments

**2** (лимиты UCS-2: 70 для одной SMS, 67 на часть длинной).

**1 сегмент с названием недостижим** при 128-битном токене. Даже вариант 3 с
13-символьным доменом (`https://as.kz`) — 80 символов. Одна SMS получается
только без названия и с коротким собственным доменом (64 символа — тест).

Для этого добавлен `RECOVERY_LINK_BASE_URL` — короткий **собственный** домен
на тот же деплой. Сторонние сокращатели не используются.

### 26. Provider-reported segments

`segNum` из `GetSMSStatus` сохраняется в `providerSegments`. В сквозном тесте
он совпадает с нашей оценкой (2). Расхождение обработку не ломает: поле
только для наблюдения, не для биллинга.

### 27. Long business name handling

Только для SMS: обрезка до 24 символов с «…». `Business.name` не меняется.
Тесты на короткое, длинное кириллическое и длинное латинское название: ≤ 2
сегментов, ссылка всегда целиком.

### 28. Settings UI

Settings → Channels, карточка «Восстановление пропущенных звонков» получила
блок SMS-провайдера:
- «SMS-провайдер: Mobizon · режим: рабочий · настроен / не настроен»;
- «Отправитель: AUTOSERVISE — общий отправитель AUTOSERVISE, не собственное
  имя вашего автосервиса» (или «отправитель по умолчанию аккаунта Mobizon»);
- «отчёты о доставке подключены / не подключены».

Ключ не показывается и не редактируется. Админ-панели Mobizon нет.

### 29. Conversation UI

Значок доставки автоматических сообщений:
- «Отправляется»;
- «Отправка не подтверждена» (`DELIVERY_UNCERTAIN`);
- «Принято оператором»;
- «Доставлено» / «Доставлено частично» / «Не доставлено»;
- «Ошибка доставки».

Сырой код (`DELIVRD`) — только во всплывающей подсказке. Логика — чистая
функция `deliveryLabel` (тесты).

### 30. Privacy / logging

- В логах `sms_provider_send`: id доставки, исход, код, кодировка, сегменты.
- В логах вебхука: `eventId`, id доставки, статус; номер — маской.
- URL запросов (там ключ) не логируются.

Тест в `afterEach` каждого из 40 тестов проверяет, что ни одна строка лога
не содержит ключ, полный номер, токен моста или текст SMS. Ответы вебхука —
только `{ ok }`.

### 31. Tenant isolation

- Отчёт ищет доставку только по `(provider, messageId)` и сверяет номер.
- Поля `tenantId` / `businessId` в теле вебхука игнорируются.

Тест подмены: отчёт по сообщению тенанта 2 с номером тенанта 1 даёт
`DESTINATION_MISMATCH` — ничего не изменено. Корректный отчёт меняет только
доставку тенанта 2, тенант 1 не тронут.

### 32. Successful vertical slice

Пропущенный звонок:
1. MCR-4.1 → маршрутизатор (UNKNOWN) → `SMS_BRIDGE` → `MobizonSmsAdapter`;
2. подменённый HTTP 200 `code 0, messageId 169275418` — **один** запрос;
3. доставка `SENT`, `provider mobizon`, id сохранён; звонок `SENT`;
4. подписанный отчёт, `GetSMSStatus` = DELIVRD, `segNum 2` — `DELIVERED`;
5. мост — `302 wa.me/77272500100`.

WhatsApp-отправок 0, AI 0, входящих 0, согласий 0, клиентов, автомобилей,
заявок и записей 0 (ловушки). PII в URL и логах нет.

### 33. Failure slice

`code 1` (неверный номер):
- звонок `FAILED SMS_REJECTED`, `recoverySentAt = null`, доставка `FAILED`;
- повтор — `SKIPPED`, ровно 1 запрос;
- WhatsApp нет, открытий ссылки 0.

### 34. Uncertain slice

Таймаут / abort:
- доставка `SENDING` + `DELIVERY_UNCERTAIN`, звонок `FAILED
  DELIVERY_UNCERTAIN`;
- два повтора из очереди — `SKIPPED`;
- ровно 1 запрос к Mobizon, WhatsApp 0.

### 35. Webhook security tests

Покрыто:
- верная подпись;
- неверный секрет — 403;
- без подписи — 400;
- изменённое подписанное поле — 403;
- битый JSON — 400;
- нет секрета — 503.

Во всех отказных случаях записей 0 и запросов статуса 0.

Также покрыто:
- дубликат и повтор с новым `attempt`;
- неизвестный id — 200 без изменений;
- подмена тенанта и номера;
- порядок отчётов;
- недоступный статус — 503 без строки события, затем применится;
- чужой тип события;
- GET — 405.

Мутационная проверка:
- отключение проверки подписи — падает тест безопасности;
- снятие обработки UNCERTAIN — падает тест неопределённости.

### 36. MCR regressions

Полный набор зелёный:
- MCR-1 (телефоны);
- MCR-2 (приём звонков);
- MCR-4 / 4.1;
- MCR-5;
- MCR-6;
- Prompt 53 / 55 / 56;
- изоляция тенантов;
- Telegram.

Изменён один существующий тест: `markSent` теперь получает `provider`.

### 37. Total tests before / after

| | Количество |
|---|---|
| До | **2014 / 2014**, 91 файл |
| Добавлено | **+40** (`tests/mobizonSms.test.ts`) |
| После | **2054 / 2054**, 92 файла |

### 38. Typecheck

`npm run typecheck` — без ошибок.

### 39. Build

`npm run build` — успешно; предупреждение о размере чанка было и раньше.

### 40. Prisma

`prisma validate` — valid. `prisma format --check` не трогался.

### 41. Supabase migration status

`migrate deploy` применил `20261008120000_mobizon_sms_transport`.
`migrate status`: 24 миграции, up to date.

Read-only проверка:
- 16 существующих доставок, у всех новые поля NULL;
- событий вебхука 0;
- enum `ProviderDeliveryState` из 6 значений.

### 42. Browser / mobile verification

**Не выполнена:** браузерные инструменты в этой сессии отключены. UI
проверен typecheck, сборкой и юнит-тестами `deliveryLabel` и
`smsTransportView`. Новые элементы — строки текста в существующих карточках.

### 43. Real paid SMS sent

**NO.** Учётных данных Mobizon в окружении нет. Тесты ходят только в
in-process транспорт (`setMobizonFetchForTests`).

### 44. Exact Mobizon activation checklist

Для владельца; в MCR-7A не выполнялось. Шаги — по документации Mobizon.

1. Зарегистрировать аккаунт на **mobizon.kz** и пройти проверку аккаунта по
   требованиям Mobizon.
2. Выбрать тариф и пополнить баланс.
3. Включить API: **Панель управления → настройки API → «Включить доступ к
   API»** и скопировать ключ API.
   - Там же есть **список разрешённых IP**. У функций Vercel нет постоянных
     исходящих IP. Нужно либо оставить доступ без ограничения по IP (если
     Mobizon это разрешает), либо подключить статические исходящие IP
     Vercel. **Проверить до запуска.**
4. Отправитель:
   - для пилота — общий отправитель аккаунта;
   - или подать заявку на собственное альфа-имя и дождаться одобрения;
   - `MOBIZON_SENDER` задавать **только после одобрения**.
5. Вебхук: **Панель управления → API → Вебхуки → «Создать вебхук»**:
   - тип «Статусы SMS»;
   - формат **json**;
   - URL `https://<APP_URL>/api/webhooks/channels/mobizon`;
   - **секретный ключ** — случайная строка от 32 символов;
   - статус «Активен».
6. Vercel → Project → Settings → Environment Variables (Production):
   - `SMS_PROVIDER=mobizon`;
   - `MOBIZON_API_KEY`;
   - `MOBIZON_WEBHOOK_SECRET` — тот же секрет;
   - при необходимости `MOBIZON_SENDER`;
   - `APP_URL` (https), при необходимости `RECOVERY_LINK_BASE_URL`;
   - `RECOVERY_MOCK_CHANNEL_ENABLED` в production не задавать.
7. Задеплоить. В Settings → Каналы должно быть: «Mobizon · рабочий ·
   настроен · отчёты о доставке подключены».
8. В Settings → Каналы:
   - создать и активировать канал **SMS**;
   - у канала WhatsApp указать «Номер WhatsApp для клиентов».
9. Контрольная SMS. **В production пропущенный звонок сейчас взять неоткуда:**
   реальная телефония — MCR-8, mock-телефония в production выключена.
   Поэтому первый живой тест — после MCR-8, или отдельным разовым
   контролируемым запуском. Такой запуск не входит в MCR-7A.
10. Проверить отчёт: в карточке диалога значок станет «Доставлено». В панели
    Mobizon, в журнале вебхука, — ответ 200.

### 45. Known limitations

- **Не проверено вживую:**
  - реальный API Mobizon (формат ответов взят из документации);
  - реальный вебхук;
  - Vercel.
- **Список IP Mobizon против динамических IP Vercel** (§44, шаг 3) —
  возможный блокер запуска.
- **Подпись вебхука не покрывает `data`.** Это компенсируется запросом
  статуса и сверкой номера. Следствие: вебхуку нужен рабочий доступ к API —
  при недоступности API отвечает 503 и ждёт повтора.
- **Отчёт по доставке UNCERTAIN не сопоставить:** id сообщения не получен.
  Решает человек; кнопки в UI для этого пока нет.
- **2 сегмента — норма** при названии бизнеса (§25).
- **Учётные данные на каждый бизнес** и собственные отправители автосервисов
  — не реализованы. Это пилот на одном аккаунте.
- **Входящих / двусторонних SMS нет.**
- **Числовые лимиты Mobizon** не документированы. Код 30 / HTTP 429
  обрабатываются как временная ошибка.

### 46. MCR-7B readiness

Тот же контракт `ChannelAdapter` и тот же паттерн подойдут реальному
WhatsApp (MCR-7B):
- `provider`, `uncertain`;
- монотонный `providerDeliveryState`;
- `ProviderWebhookEvent` для идемпотентности вебхуков;
- проверка подписи до записи;
- поиск по `(provider, externalMessageId)`.

Входящий WhatsApp-вебхук ляжет на существующий `receiveIncoming`: он откроет
окно MCR-6 и запустит MCR-5.

### 47. Answers A–J

- **A — отправка SMS_BRIDGE через реальный Mobizon при наличии ключей: YES.**
  Адаптер собран по официальному контракту и проверен на точной форме
  запроса и ответа. Живого вызова не было (§43).
- **B — без ключей приложение и тесты работают без Mobizon: YES.** Без
  ключей SMS «unavailable» или mock (dev / test); тесты используют
  in-process транспорт.
- **C — вебхук обновляет нужную доставку, не доверяя `tenantId` /
  `businessId`: YES.** Поиск по `(mobizon, messageId)`, сверка номера,
  статус из API; тест подмены.
- **D — может ли неверная подпись изменить состояние: NO.** Проверка до
  записи; тесты на 0 записей; мутация проверки ломает тест.
- **E — может ли дубликат вебхука создать дубли: NO.** Unique `eventId` и
  одна транзакция; отчёты не создают сообщений и событий.
- **F — может ли таймаут после возможного принятия дать вторую SMS: NO.**
  Исход UNCERTAIN, доставка остаётся `SENDING` и не повторяется (ровно 1
  запрос в тесте); мутация ломает тест.
- **G — может ли сбой доставки вызвать WhatsApp после принятия SMS: NO.**
  Маршрут закреплён, статусы доставки ничего не отправляют, после попытки
  запасного пути нет.
- **H — нужно ли переписывать движок восстановления: NO.** Движок и
  маршрутизатор не менялись; Mobizon подключается через реестр адаптеров.
- **I — MCR-5 по-прежнему только от настоящих входящих: YES.** Отчёты и мост
  не создают входящих и AI-ходов; входящие SMS отклоняются.
- **J — можно ли позже заменить Mobizon другим SMS-провайдером: YES.** Новый
  адаптер `ChannelAdapter` (`SMS`) и выбор в `smsTransport`; статусы
  провайдера сопоставляются в `deliveryStatus.ts`.

### 48. Git result

Один коммит `feat: add production mobizon sms transport`. Он запушен в
`origin/master` без force; локальный `master` совпадает с `origin/master`,
рабочее дерево чистое. Хэш — в итоговом сообщении.
