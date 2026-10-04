## Final Report — MCR-8A: Production Telephony (Kcell Virtual PBX)

Пропущенный звонок теперь может приходить **из настоящей Виртуальной АТС
Kcell**. Начало продукта замкнуто:

    клиент звонит → никто не взял трубку → Kcell присылает event / history
    → CallInteraction → MISSED → READY → очередь missed-call-recovery
    → Recovery Engine → MCR-6 → SMS-мост (Mobizon) или разрешённый WhatsApp

Главное:
- Kcell подключён через **существующую** границу `TelephonyAdapter` из
  MCR-2. Второго «движка звонков» нет. Recovery Engine и MCR-5 не знают о
  Kcell.
- Колбэк принимается только с верным `crm_token`. Токен у каждого бизнеса
  свой, хранится на сервере и сравнивается за постоянное время. Проверка идёт
  **до любой записи**.
- Бизнес определяется **только по номеру, на который звонили** (`diversion`)
  через `BusinessPhoneNumber`. Этот номер должен принадлежать тому же бизнесу,
  что и токен. Номер звонящего и tenantId / businessId из тела запроса
  бизнес не выбирают.
- **CANCELLED ≠ MISSED.** В групповом звонке CANCELLED одного менеджера
  ничего не решает. Исход звонка решают ответ (ACCEPTED / COMPLETED) или
  итоговый `history`.
- Ответ на звонок сильнее любого «пропущен»: ANSWERED никогда не
  откатывается в MISSED.
- Повторные колбэки идемпотентны: один звонок, одно событие, одна SMS.

**Настоящих звонков Kcell не принималось.** Учётных данных нет, тесты к Kcell
не обращаются.

MCR-8B (живая активация), Beeline, голосовой AI и MCR-9 не начинались.

---

### 1. Baseline

`ef8eab5 feat: add production twilio whatsapp transport`. Проверено до
изменений:
- ветка `master`;
- `HEAD` совпадает с `origin/master`;
- рабочее дерево чистое;
- тесты 2090 / 2090.

Изучены:
- MCR-1 `phone.ts`;
- MCR-2 `TelephonyAdapter`, `MockTelephonyAdapter`, `callStateMachine`,
  `callIntakeService`, `CallInteraction`, `CallEvent`, `BusinessPhoneNumber`;
- MCR-4 / 4.1 (`recoveryJobs`, claim, late answer);
- MCR-6 router; адаптеры Mobizon и Twilio; Settings → Channels; `env.ts`.

Расхождений нет.

### 2. Изменённые файлы

Новые:
- `src/server/telephony/adapters/kcell/kcellTelephonyAdapter.ts` — разбор, маппинг, токен, отпечаток события.
- `src/server/services/kcellWebhookService.ts` — порядок проверок вебхука.
- `src/server/services/kcellConnectionService.ts` — подключение и статус для настроек.
- `src/server/repositories/telephonyConnectionRepository.ts`.
- `api/webhooks/telephony/kcell.ts` — публичный CRM URL для Kcell.
- `api/telephony/kcell.ts` — GET статус, POST подключить, DELETE отключить.
- `prisma/migrations/20261010120000_kcell_telephony/migration.sql`.
- `tests/kcellTelephony.test.ts` (27 тестов).
- `docs/prompts/mcr-8a.md`, этот отчёт.

Изменённые:
- `prisma/schema.prisma`;
- `src/server/lib/env.ts` (`kcellCrmTokens`);
- `src/server/telephony/types.ts`, `callStateMachine.ts`;
- `src/server/services/callIntakeService.ts`;
- `src/server/repositories/callInteractionRepository.ts`;
- `src/components/channels/recoverySetup.ts`;
- `src/pages/settings/ChannelsSettingsPage.tsx`;
- `.env.example`, `PRODUCT_BLUEPRINT.md`, аудит.

### 3. Схема и миграция

Миграция `20261010120000_kcell_telephony` только добавляет:

| Изменение | Назначение |
|---|---|
| `CallEventType.OBSERVED` | событие провайдера без утверждения об исходе (CANCELLED одной «ноги», TRANSFERRED, недокументированный статус) |
| `CallEvent.providerStatus String?` | короткий код провайдера: `event:CANCELLED`, `history:in:Missed` (без PII) |
| `CallInteraction.outcomeConflictAt DateTime?` | ответ пришёл, когда восстановление уже было у движка |
| `TelephonyConnection` + enum `TelephonyConnectionStatus` | подключение бизнеса к провайдеру телефонии; `@@unique([businessId, provider])`; **без секретов** |

Применённые миграции не менялись.

### 4. Контракт Kcell

Источники:
- [manual.kcell.kz/rest_api](https://manual.kcell.kz/rest_api) ссылается на
  API-портал `api.vpbx.kcell.kz` (раздел crmapi). Портал — одностраничное
  приложение, мои инструменты не смогли его прочитать.
- Поэтому использован документ той же облачной платформы ВАТС: «REST API
  Облачной АТС», раздел 4 «Запросы от ВАТС к CRM».
  - Kcell ВАТС построена на платформе Cloud PBX Solutions; её приложение
    Bitrix24 называется `itoolabs.kcell`.
  - Набор команд и полей полностью совпадает с промптом.

Команды от АТС к CRM (POST на один URL):

| cmd | поля |
|---|---|
| `event` | `type` (INCOMING / ACCEPTED / COMPLETED / CANCELLED / OUTGOING / TRANSFERRED), `direction` in/out, `phone`, `diversion`, `user`, `ext`, `telnum`, `groupRealName`, `callid` («совпадает для всех связанных звонков»), `crm_token`. **Нет id события и нет времени** |
| `history` | `type` in/out, `status` (Success / Missed / Cancel / Busy / NotAvailable / NotAllowed / NotFound), `phone`, `diversion`, `user`, `start` (UTC `YYYYmmddTHHMMSSZ`), `duration` (с), `callid`, `link` (запись), `crm_token` |
| `contact` | `phone`, `callid`, `crm_token`; АТС ждёт `contact_name` / `responsible` |

Ответы: JSON — `200`, `400 {error:"Invalid parameters"}`,
`401 {error:"Invalid token"}`. Взаимодействие по HTTPS.

Отличия от промпта и неясности (проверить в MCR-8B):
- `callid` в `history` по таблице документа необязателен. Мы требуем его:
  без `callid` колбэк нельзя связать с остальными событиями звонка, поэтому
  ответ `400`.
- `diversion` в `event` необязателен — см. п. 11.
- Поведение повторов и IP-адреса источника не документированы.
- Не документировано, приходит ли `history` по одному на звонок или по
  одному на каждую «ногу».

### 5. Архитектура адаптера

    TelephonyAdapter (MCR-2)
      ├ MockTelephonyAdapter (без изменений)
      └ KcellTelephonyAdapter: verify (crm_token → бизнес) + parse → NormalizedCallEvent

Изменения провайдер-нейтральной части — только расширения:
- `NormalizedCallEvent` получил необязательные `callStartedAt`, `callEndedAt`,
  `providerStatus`;
- `TelephonyAuthResult` получил `accountBusinessId`;
- в state machine добавлено событие `OBSERVED`;
- в intake добавлена опция `expectedBusinessId`.

Recovery Engine, router и MCR-5 не изменены и не импортируют Kcell.

### 6. Модель подключения

`TelephonyConnection(businessId, provider='kcell', status, connectedAt,
disabledAt)`, одна строка на бизнес и провайдера. Номера бизнеса — его
активные `BusinessPhoneNumber`, их может быть несколько. Звонки разных
бизнесов разделены: у каждого свой токен, свои номера и своя строка.

### 7. Токен

- `KCELL_CRM_TOKENS` = `<businessId>=<token>,…` в переменных окружения
  сервера. В БД токен не хранится, во фронтенд не попадает, в логи не пишется.
- Минимум 24 символа из `[A-Za-z0-9._~-]`.
- Если один токен указан у двух бизнесов, отбрасываются обе записи: угадывать
  между ними нельзя.
- **Ротация:** временно указать у бизнеса два токена (старый и новый),
  переключить Kcell, затем удалить старый.
- Для многих бизнесов `env` заменяется хранилищем секретов за той же функцией
  `kcellBusinessForToken`. Доменная модель от этого не меняется.

### 8. Вебхук

`POST /api/webhooks/telephony/kcell` — единый CRM URL для Kcell. Сессия
пользователя не нужна, аутентификация — токен провайдера.

Тело принимается как форма или JSON. Сырая строка формы тоже разбирается.
Ограничения: не больше 40 ключей, значения до 2000 символов.

### 9. Аутентификация

Порядок:
1. параметры;
2. `crm_token` → бизнес;
3. у этого бизнеса подключение Kcell должно быть ACTIVE.

Если что-то не так — `401 {error:"Invalid token"}`, и **ничего не прочитано
из звонков и ничего не записано**.

### 10. Граница безопасности

Это **общий секрет в теле запроса, а не подпись**.
- Токен доказывает, что отправитель его знает. Целостность данных он не
  гарантирует.
- Защита держится на HTTPS (TLS) и секретности токена.

Меры:
- только HTTPS (в production `APP_URL` должен быть https);
- длинный случайный токен, свой у каждого бизнеса;
- сравнение за постоянное время, без раннего выхода;
- токен никогда не логируется и не возвращается;
- ротация.

IP-allowlist **не делался**: Kcell официально не публикует адреса.

Ущерб от утечки токена ограничен:
- можно создать звонки только на номера **этого же** бизнеса;
- клиенту в худшем случае уйдёт одна SMS восстановления, с антиспамом
  MCR-4.

### 11. Маршрутизация бизнеса

`diversion` («ваш номер, через который пришёл вызов») → E.164 → активный
`BusinessPhoneNumber` → бизнес → тенант. Номер обязан принадлежать бизнесу
токена (`expectedBusinessId`).
- Чужой или неизвестный номер — `200 {}`, ничего не записано. Ответ одинаков
  для обоих случаев, так что существование бизнеса не раскрывается.
- `telnum` (прямой номер сотрудника) используется только для исходящего
  звонка без `diversion`.
- Если в колбэке нет номера, событие принимается только существующим
  звонком этого бизнеса с тем же `callid`. Иначе оно игнорируется.

### 12. Нормализация звонящего

Kcell присылает цифры без «+» (`79101234567`).
- 11–15 цифр, не начинающиеся с 8, считаются международным номером:
  добавляется «+».
- Иначе номер нормализуется в регионе бизнеса (MCR-1). `87011234567` →
  `+77011234567`.
- anonymous / hidden → `null`.

### 13. Маппинг event

| Kcell | событие | исход |
|---|---|---|
| INCOMING / OUTGOING | RINGING | нет |
| ACCEPTED | ANSWERED | ответ |
| COMPLETED («завершён после разговора») | COMPLETED, answered | ответ |
| CANCELLED | **OBSERVED** | **нет** |
| TRANSFERRED / неизвестный | OBSERVED | нет |

### 14. Маппинг history

| Kcell | исход |
|---|---|
| Success | ответ (ANSWERED) |
| Missed | пропущен (MISSED) |
| Cancel («звонок отменён»: клиент сдался до ответа) | пропущен |
| Busy / NotAvailable / NotAllowed / NotFound, исходящий | не отвечен (OUTBOUND → не лид) |
| те же статусы на входящем (не документировано) / неизвестный | OBSERVED |

### 15. CANCELLED и групповой звонок

Kcell прямо пишет: CANCELLED — это «клиент не дождался, **либо** на звонок
группе ответил кто-то ещё». Поэтому CANCELLED записывается в журнал
(`OBSERVED`), но **не меняет исход** — даже время окончания не трогает.

Тест группы проходит последовательность INCOMING ×2 → CANCELLED (andy) →
ACCEPTED (bob) → COMPLETED → history Success. Итог: ANSWERED, NOT_ELIGIBLE,
ноль SMS.

### 16. Итоговое «пропущен»

MISSED ставится только итоговым `history` (Missed / Cancel), либо
недвусмысленным событием от mock. После этого MCR-2 `recoveryFor`:
входящий + MISSED + валидный номер → READY.

Если `history` не придёт, звонок остаётся IN_PROGRESS и восстановления не
будет. Это сознательный выбор: ложный «пропущен» хуже. Проверяется в MCR-8B.

### 17. callid

`providerCallId = callid`, уникальность `(provider, providerCallId)` из MCR-2.
Все «ноги» и колбэки одного звонка сходятся в один `CallInteraction`. Если
`callid` уже принадлежит другому бизнесу, событие игнорируется
(`CALL_ROUTING_CONFLICT`).

### 18. Отпечаток события

У Kcell нет id события, поэтому `providerEventId` — это
`event:` / `history:` + SHA-256 от документированных стабильных полей:
- для event: callid, type, direction, user, ext, telnum, phone, diversion,
  groupRealName;
- для history: callid, type, status, user, ext, telnum, phone, diversion,
  start, duration.

Время получения, случайность, `link` и `crm_token` в отпечаток не входят.

Допущение о коллизиях: одна и та же «нога» не сообщает один и тот же тип
события дважды в одном `callid`. Если это всё же случится, повтор
отбрасывается. Это безвредно: повтор несёт то же самое свидетельство.

### 19. Дубликаты

- `CallEvent @@unique(provider, providerEventId)`: повторный колбэк — это
  duplicate, без эффектов.
- Если дубликат застаёт звонок в READY, он заново публикует задание **с тем
  же ключом идемпотентности** (MCR-4.1: восстановление после сбоя
  публикации).
- Очередь отбрасывает повторную публикацию, а атомарный claim движка делает
  лишние доставки пустыми.

Тест: 5 одновременных INCOMING и 5 одновременных history Missed дают
1 звонок, 2 события и **1 SMS**.

### 20. Порядок событий

Монотонная state machine MCR-2 (IN_PROGRESS < MISSED < ANSWERED):
- **A:** Missed, затем INCOMING — остаётся MISSED / READY. Время начала
  берётся из `start`.
- **B:** CANCELLED → ACCEPTED → Success — итог ANSWERED.
- **C:** ACCEPTED, затем запоздавший Missed — **остаётся ANSWERED**.
  Решение: ACCEPTED означает, что менеджер снял трубку. Это достоверное
  свидетельство ответа, и оно сильнее любого «Missed». Автоматическое
  восстановление на отвеченный звонок недопустимо.

### 21. Защита отвеченного звонка

ANSWERED → `NOT_ELIGIBLE / ANSWERED`:
- ни SMS, ни WhatsApp, ни AI;
- не создаются Customer / Request / Appointment (ловушки в тестах).

Поздний ответ, пришедший пока звонок в READY, переводит его в NOT_ELIGIBLE.
Потребитель очереди после этого ничего не отправляет: блокировки MCR-4 не
ослаблялись.

### 22. Исходящие звонки

OUTGOING и `history type=out`:
- звонок записывается, `direction` OUTBOUND;
- `NOT_ELIGIBLE / OUTBOUND`;
- не становится лидом ни при каком статусе (Busy, Missed…).

### 23. Невалидный звонящий

anonymous, «123» или номер, невалидный в регионе: звонок сохраняется,
`remotePhoneE164 = null`, `NOT_ELIGIBLE / NO_CALLER_PHONE`, сообщений нет.

### 24. Связь с клиентом

Поведение MCR-2: ровно один активный клиент с этим номером в бизнесе —
звонок связывается с ним. Если клиентов несколько или ни одного — связи нет.
Клиенты не создаются.

### 25. Время

| поле | источник |
|---|---|
| `startedAt` | `history.start` (самое раннее) |
| `endedAt` | `start + duration` |
| `firstEventReceivedAt` / `lastEventReceivedAt` | время получения AUTOSERVISE |
| `outcomeDetectedAt` | когда здесь впервые стал известен итог (момент «пропущен обнаружен») |
| `recoveryClaimedAt` / `recoverySentAt` | MCR-4; `recoverySentAt` = провайдер принял сообщение |

Время получения никогда не подставляется вместо времени провайдера.

### 26. Наблюдаемость задержки

Обе метрики MCR-9 считаются из уже сохранённых полей:
- `outcomeDetectedAt − endedAt` — задержка обнаружения;
- `recoverySentAt − outcomeDetectedAt` — от «пропущен» до «отправлено».

В сквозном тесте вторая задержка равна ровно 3 с. Дашборд не делался.

### 27. Триггер очереди

Используется существующий топик `missed-call-recovery`, задание содержит
только `{ callInteractionId }`. Новой очереди нет. Вебхук записывает событие
и сразу отвечает; движок работает в потребителе очереди. Если публикация не
удалась — ответ 500, повтор безопасен, внутренний процессор подстрахует.

### 28. Интеграция с восстановлением

Тест проходит цепочку Kcell → READY → `handleRecoveryJob` → MCR-6
(consent UNKNOWN → SMS_BRIDGE) → Mobizon (поддельный HTTP). Результат: SENT,
`recoveryChannel = SMS_BRIDGE`.

### 29. Приватность

В логах только id звонка, код статуса, итог и маска номера. Тесты проверяют,
что в логах нет токенов, полного номера и URL записи.

- Ссылка на запись (`link`) не сохраняется и не скачивается.
- Имена сотрудников АТС (`user`) не сохраняются; они только входят в хэш
  отпечатка.
- На `contact` отвечаем `{}`: данные клиентов в АТС не уходят.

### 30. Settings

В блоке «Восстановление пропущенных звонков» появилась строка «Телефония:
Kcell Виртуальная АТС · подключено». Под ней:
- маскированные номера;
- «пропущенные звонки: включены / не поступают»;
- кнопки «Подключить Kcell» / «Отключить Kcell» для владельца и админа.

Токена и SIP-данных в интерфейсе нет. Если в production ничего не
настроено, показывается «не подключена»; mock не подставляется.

### 31. Сквозной сценарий «пропущен»

1. INCOMING — 1 звонок, PENDING.
2. CANCELLED — всё ещё PENDING, заданий нет.
3. history Missed — MISSED / READY, время начала и конца от провайдера, одно
   задание `{callInteractionId}`.
4. Потребитель очереди — одна SMS через Mobizon, SENT.

Проверено: тенант t1, номер звонящего, `callid`, одна попытка.

### 32. Групповой звонок с ответом

См. п. 15: ANSWERED, NOT_ELIGIBLE, 0 заданий, 0 SMS, 0 сообщений и диалогов.

### 33. Дубликаты при одновременной доставке

См. п. 19: один звонок, одно логическое восстановление, одна SMS.

### 34. Порядок событий

См. п. 20, плюс:
- гонка «Missed → задание опубликовано → поздний ACCEPTED до потребителя»
  даёт 0 SMS;
- конфликт «SMS уже отправлена → потом ACCEPTED»: ANSWERED, состояние
  остаётся SENT, `outcomeConflictAt` записан, предупреждение
  `call_outcome_conflict` в логе, ничего не отменено и не отправлено
  повторно.

### 35. Неверный токен

Каждый из этих случаев проверен; во всех 0 звонков, 0 событий, 0 заданий:
- нет токена, неверный токен, токен в другом регистре — 401;
- токены не настроены — 401 (mock не подставляется);
- подключение отключено — 401;
- токен бизнеса B с номером бизнеса A — 200 {};
- неизвестный номер — тот же 200 {}.

### 36. Изоляция тенантов

- Один и тот же звонящий звонит в два бизнеса: два независимых звонка
  (t1 / n1 и t2 / n2), каждый получает свою SMS.
- tenantId / businessId в теле запроса игнорируются.
- Колбэк без номера с токеном другого бизнеса не попадает в чужой звонок.

### 37. Регрессии MCR

Полный набор зелёный: MCR-1, 2, 4, 4.1 (очередь), 5, 6, 7A, 7B1,
`telephonyIsolation`, `tenantIsolation`, антиспам, Prompt 53–56.

Мутационная проверка (код каждый раз восстанавливался):

| Что сломали | Упало тестов |
|---|---|
| CANCELLED → MISSED | 5 |
| обход токена | 1 |
| убрана проверка «номер того же бизнеса» | 1 |

### 38. Количество тестов

2090 → **2117** (+27), 94 файла, все проходят.

### 39. Typecheck

`tsc --noEmit` без ошибок.

### 40. Build

Production build `vite build` успешен.

### 41. Prisma

`prisma validate` — OK. Старое расхождение `prisma format --check` не
трогали.

### 42. Supabase

Миграция применена через `prisma migrate deploy`, `migrate status` —
«up to date».

Проверено в живой БД:
- `telephony_connections` пуста;
- у 21 существующего `call_events` `providerStatus = NULL`;
- у 13 звонков `outcomeConflictAt = NULL`;
- в enum есть `OBSERVED`.

### 43. Браузер / мобильная версия

Проверка в браузере (desktop и 390px) **не выполнялась**: браузерные
инструменты недоступны. Новая разметка — это строки текста с `break-words`
и одна кнопка в существующей карточке. Проверено typecheck, сборкой и
тестами `telephonyView`.

### 44. Настоящий звонок Kcell

**НЕТ.**

### 45. Чек-лист активации MCR-8B

1. **ВАТС.** Подключить Виртуальную АТС Kcell (vats.kcell.kz; есть
   тестовый период) для автосервиса.
2. **Номер.** Выбрать номер мастерской: виртуальный номер Kcell или
   существующий номер.
3. **Существующий номер.** Завести его в ВАТС: по SIP (регистрация или
   SIP URI) либо обычной переадресацией на номер ВАТС. Способ уточнить у
   менеджера Kcell для конкретного оператора номера. AUTOSERVISE в любом
   случае видит номер в `diversion`.
4. **Входящая группа.** Настроить маршрутизацию входящих на сотрудника или
   группу, чтобы неотвеченный звонок завершался со статусом Missed.
5. **Токен.** Сгенерировать длинный случайный токен (32+ символа, например
   `openssl rand -base64 32` без `/+=`).
6. **Интеграция REST API.** В веб-кабинете ВАТС: раздел интеграций →
   интеграция с CRM по REST API (manual.kcell.kz/rest_api). Указать адрес
   `https://<APP_URL>/api/webhooks/telephony/kcell` и вставить токен в поле
   ключа. Включить отправку событий и истории звонков.
7. **Vercel.** В Production задать
   `KCELL_CRM_TOKENS=<businessId>=<тот же токен>` и `APP_URL` (https).
8. **Номер в AUTOSERVISE.** Добавить номер мастерской как активный
   `BusinessPhoneNumber` бизнеса (`POST /api/business/phone-numbers`, формат
   E.164).
9. **Деплой.** Задеплоить, затем Settings → Каналы → «Подключить Kcell»
   (владелец или админ). Должно появиться «подключено · пропущенные звонки:
   включены».
10. **Тест: отвеченный звонок.** Позвонить с личного телефона и ответить.
11. **Проверка.** Звонок ANSWERED, NOT_ELIGIBLE, SMS нет.
12. **Тест: пропущенный звонок.** Позвонить и не отвечать до сброса.
13. **Проверка.** Звонок MISSED → READY → SENT. Убедиться, что `history`
    пришёл и в нём есть `callid`; в `call_events` должно быть видно
    `history:in:Missed`.
14. **Задержка.** Замерить `outcomeDetectedAt − endedAt` и
    `recoverySentAt − outcomeDetectedAt`.
15. **Канал восстановления.** Проверить SMS-мост → WhatsApp (MCR-7A / 7B1).
16. **Повторы и группа.** Проверить групповой звонок (ответил второй
    менеджер — восстановления нет) и что повторные колбэки ничего не
    дублируют.

### 46. Ограничения Kcell

- Аутентификация — общий токен в теле запроса, без подписи; IP-адреса не
  документированы.
- Повторы доставки не документированы. Если Kcell не повторяет, колбэк,
  потерянный при сбое у нас, теряется. READY-звонки подстраховывает
  внутренний процессор, но не потерянный `history`.
- Без `history` звонок остаётся IN_PROGRESS (п. 16).
- `history` без `callid` отклоняется (400).
- У событий нет времени: время звонка берётся только из `history`.
- Пилот: токены в `env`, один токен или ротационная пара на бизнес.

### 47. Готовность к Beeline и другим провайдерам

Новый провайдер — это новый файл `adapters/<provider>`, который реализует
`verify` / `parse` → `NormalizedCallEvent`, плюс свой маршрут вебхука.
`TelephonyConnection.provider` уже провайдер-нейтрален.
`CallInteraction`, intake, state machine и Recovery Engine не меняются.

### 48. Ответы A–K

| | Ответ | Основание |
|---|---|---|
| A | **YES** | вебхук → токен → номер → звонок; tenant/business из тела игнорируются (тест «hints are ignored») |
| B | **YES** | маршрут по `diversion` → `BusinessPhoneNumber`; номер звонящего только нормализуется |
| C | **NO** | CANCELLED = OBSERVED; групповой тест; мутация ловится 5 тестами |
| D | **YES** | history Missed → MISSED → READY → задание (сквозной тест) |
| E | **YES** | ACCEPTED / COMPLETED / Success → ANSWERED → NOT_ELIGIBLE; гонка с очередью — 0 SMS |
| F | **NO** | отпечаток + уникальность `CallEvent` + claim движка; 5×5 одновременных дают 1 SMS |
| G | **NO** | 401 до чтения и записи; тесты «missing / wrong / disabled» |
| H | **NO** | OUTBOUND → NOT_ELIGIBLE при любом статусе |
| I | **YES** | маршрут по номеру, на который звонили, независимо от того, кто его выдал (п. 45, шаг 3) |
| J | **YES** | тот же топик `missed-call-recovery`, `{callInteractionId}`; движок только в потребителе очереди |
| K | **YES** | граница `TelephonyAdapter` + `TelephonyConnection.provider` (п. 47) |

### 49. Git

Один коммит `feat: add production kcell telephony transport`. Он запушен в
`origin/master` без force; локальный `master` совпадает с `origin/master`,
рабочее дерево чистое. Хэш — в итоговом сообщении.
