## Final Report — Prompt 48: Service Follow-up / Retention Loop

### 1. Implementation Result

Реализовано: после сохранённого ServiceRecord появляется структурированный следующий контакт (`ServiceFollowUp`). Он виден в `/operations`, в карточке клиента и в карточке автомобиля. Из него одним действием создаётся новый `CustomerRequest`. Retention loop замкнут:

```text
Customer → Customer Request → Appointment → Service → Service Record
→ Service History → Service Follow-up → Customer Request
```

Весь scope §2 реализован. Исключение одно, и оно не в коде: миграция **не применена к рабочей базе Supabase**, потому что база весь день недоступна (`P1001: Can't reach database server`). Подробности в §3 и §15. Миграция и весь функционал проверены на локальной временной PostgreSQL 17 (§3, §12).

`BOOKED` реализован без изменения существующего lifecycle: когда связанный `CustomerRequest` переходит в `CONVERTED` (а это возможно только с реальным appointment), follow-up переходит `CONTACTED → BOOKED` (§13 prompt).

Ничего сверх scope не добавлялось: нет рассылок, cron, фоновых задач, AI-напоминаний, capacity, billing. Launch screen и дизайн-токены не тронуты.

### 2. Data Model

**`Service.repeatIntervalDays Int?`**: `null` — «Не задан», иначе целое число дней больше нуля. Существующие услуги получают `NULL`.

**`ServiceFollowUp`** (таблица `service_follow_ups`):

| Поле | Тип | Смысл |
|---|---|---|
| `id` | uuid | — |
| `tenantId`, `businessId` | FK, Cascade | изоляция |
| `customerId`, `vehicleId` | FK, Restrict | копия из ServiceRecord |
| `serviceId?` | FK, Restrict | копия из ServiceRecord |
| `serviceRecordId?` | FK, Restrict, **`@unique`** | источник; уникальность — гарантия идемпотентности на уровне БД |
| `dueAt` | timestamp | UTC-момент локальной полуночи дня контакта в `Business.timezone` |
| `status` | `ServiceFollowUpStatus` | `PENDING` / `CONTACTED` / `BOOKED` / `DISMISSED`, по умолчанию `PENDING` |
| `customerRequestId?` | FK, Restrict | ставится один раз при «Создать обращение» |
| `note?` | text | — |
| `createdAt`, `updatedAt` | timestamp | — |

Индексы:

| Индекс | Для чего |
|---|---|
| `[tenantId, businessId, status, dueAt]` | обязательный, очередь Operations |
| `[tenantId, businessId, customerId, status, dueAt]` | Client Detail |
| `[tenantId, businessId, vehicleId, status, dueAt]` | Vehicle Detail |
| `[customerRequestId]` | переход в BOOKED при CONVERTED |
| unique `serviceRecordId` | идемпотентность |

Обратные связи добавлены в Tenant, Business, Customer, Vehicle, Service, ServiceRecord (`followUp ServiceFollowUp?`) и CustomerRequest. Стиль relations — как в остальной схеме (Cascade для tenant/business, Restrict для доменных связей).

### 3. Migration

Файл `prisma/migrations/20260929120000_service_follow_up_retention_loop/migration.sql`.

Состав: `ADD COLUMN "repeatIntervalDays" INTEGER`, CHECK `"repeatIntervalDays" IS NULL OR > 0`, `CREATE TYPE`, `CREATE TABLE`, 4 индекса, unique-индекс, 7 FK.

- **Только добавления, backward-compatible.** Ни одна существующая колонка, ограничение или строка не меняется и не удаляется.
- **Написана вручную**, как в Prompt 44: `prisma migrate dev` падает на давнем дефекте порядка миграций (см. final-report-44). SQL сверен с `prisma migrate diff`: он совпадает с тем, что генерирует Prisma, включая усечённые Prisma имена двух индексов. Отличие одно — намеренный CHECK, дублирующий Zod-валидацию на уровне БД.
- **`npx prisma validate`**: PASS.
- **Применение к локальной PostgreSQL 17** (временная, во временной папке, `.env` не менялся):
  1. схема до Prompt 48 создана `db push` из схемы `HEAD`;
  2. на неё применён этот SQL;
  3. `prisma migrate diff` от получившейся БД к новой `schema.prisma` дал **пустой результат**, то есть миграция даёт ровно новую схему;
  4. CHECK на месте.

  Цикл «сброс → применение → diff» прогонялся 4 раза, каждый раз с пустым diff.
- **Рабочая база Supabase: НЕ применено.** База `aws-0-ap-northeast-1.pooler.supabase.com` недоступна (`P1001`); Supabase MCP не авторизован (`Unauthorized`). Нужно выполнить `npx prisma migrate deploy`, когда база вернётся (§15).

### 4. Domain Logic

Файл `src/server/services/serviceFollowUpService.ts`.

**Transition matrix** (явная allow-list, как у Appointment и CustomerRequest):

```text
PENDING   → CONTACTED | BOOKED | DISMISSED
CONTACTED → BOOKED | DISMISSED
BOOKED    → (terminal)
DISMISSED → (terminal)
```

Недопустимый переход возвращает `400 INVALID_STATUS_TRANSITION` в существующем формате ошибок.

**Создание** — только после успешного сохранения ServiceRecord (`syncFollowUpForServiceRecord`, вызывается из `createServiceRecord` и `updateServiceRecord`):

| Case | Условие | Результат |
|---|---|---|
| A | передан `followUpDueDate` (`YYYY-MM-DD`) | эта дата; всегда важнее интервала |
| B | даты нет, `repeatIntervalDays > 0` | `dueAt` = локальный день `performedAt` в TZ бизнеса + N дней, локальная полночь (DST-aware, `businessLocalToUtc`) |
| C | нет даты и нет интервала, или явный `null` | follow-up не создаётся |

- ServiceRecord без Appointment (исторический) работает так же — appointment не требуется.
- Отклонённый ServiceRecord (например, привязка к CANCELLED/NO_SHOW) follow-up не создаёт; существующая защита не тронута.

**Даты.** API принимает дату как бизнес-локальный день `YYYY-MM-DD`; перевод в UTC делает сервер по `Business.timezone`. Часовой пояс браузера нигде не является источником истины.

**BOOKED.** В `updateCustomerRequest` после успешного перехода в `CONVERTED` открытые (PENDING/CONTACTED) follow-ups, связанные с этим запросом, становятся `BOOKED`. Это побочный эффект; lifecycle запроса не изменён.

Роли: запись — `owner` / `admin` / `manager` (как у ServiceRecord и CustomerRequest), чтение — любой авторизованный пользователь.

### 5. API

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/api/follow-ups?status=&dueBefore=&customerId=&vehicleId=` | все фильтры опциональны; пагинация как везде; сортировка `dueAt ASC`; `dueBefore` исключающий |
| GET | `/api/follow-ups/:id` | один follow-up; 404 для чужого или несуществующего |
| PATCH | `/api/follow-ups/:id` | только `status` (через матрицу), `dueAt` (`YYYY-MM-DD`; для BOOKED/DISMISSED → 400) и `note`; прочие ключи отбрасываются |
| POST | `/api/follow-ups/:id/request` | «Создать обращение»: 201 при создании, 200 с уже связанным запросом при повторе; ответ `{ followUp, customerRequest, created }` — ключ `customerRequest`, как у существующих endpoint'ов |

- Follow-up создаётся только через ServiceRecord, поэтому `POST /api/follow-ups` отдельно нет. `DELETE` тоже нет: follow-up закрывается статусом `DISMISSED`.
- `POST /api/service-history` и `PATCH /api/service-history/:id` принимают новое поле `followUpDueDate` (`YYYY-MM-DD` / `null` / отсутствует). Оно не пишется в строку ServiceRecord.
- `/api/services` (POST/PATCH) принимает `repeatIntervalDays` (целое больше нуля или `null`); `ServiceDto` возвращает его.

### 6. UI

Всё на существующих компонентах (Card, Badge, Button, Input `type=date/number`, текущий стиль ошибок).

**Услуги** (`/settings/services`):
- поле «Интервал повторного обслуживания [ ] дней», пустое — «Не задан»;
- в списке: «Повтор: через N дн.» или «не задан»;
- 0, отрицательные и дробные значения отклоняет браузер (`min=1`) и сервер (400).

**Форма результата обслуживания** (`/settings/service-history`), поле «Следующий контакт»:
- при создании дата подставляется как «день выполнения + интервал услуги» и пересчитывается при смене даты или услуги, пока пользователь не изменил поле сам; после ручного изменения поле больше не пересчитывается;
- пустое поле — повторный контакт не запланирован;
- при редактировании показывается текущий follow-up записи; поле отправляется только если его изменили;
- follow-up, который уже не PENDING, показывается только для чтения.

Follow-up создаётся только после «Save», не при открытии формы.

### 7. Operations

Новая секция «Повторный контакт» (`FollowUpQueueSection`) в `/operations`, после «Сегодняшние записи». Существующие секции не изменены.

- **Данные:** `GET /api/follow-ups?status=PENDING&dueBefore=<полночь (сегодня+8) в TZ бизнеса>`, то есть только PENDING со сроком не позже «сегодня + 7 дней».
- **Сортировка:** просроченные, затем сегодня, затем будущие; внутри — `dueAt ASC`.
- **Строка:** бейдж «Просрочен» / «Сегодня» / «Скоро», дата (дд.мм.гггг в TZ бизнеса), статус, клиент (ссылка), автомобиль, услуга, note.
- **Действия:**
  - «Создать обращение» → CONTACTED; появляется плашка «Обращение создано» со ссылкой; строка уходит из очереди;
  - «Отложить» → выбор новой даты, статус остаётся PENDING;
  - «Не требуется» → DISMISSED, строка уходит из очереди.
- Кнопки блокируются на время запроса. Кнопка «Обновить» страницы перезагружает и эту секцию.

### 8. Client / Vehicle Visibility

Блок «Следующий контакт» (`NextFollowUpSection`) добавлен в Client Detail и Vehicle Detail. Он показывает ближайший PENDING (`status=PENDING&pageSize=1`, сервер сортирует по `dueAt`): дату, бейдж просрочки или «сегодня», автомобиль (в карточке клиента), услугу и note. Без PENDING показывается «Следующий контакт не запланирован». CONTACTED, BOOKED и DISMISSED не считаются следующим контактом.

### 9. Idempotency

| Ситуация | Поведение |
|---|---|
| Повторное сохранение ServiceRecord | PENDING обновляется на месте (дата и копии клиента, автомобиля, услуги), дубль не создаётся |
| Follow-up уже CONTACTED / BOOKED / DISMISSED | автоматически не заменяется и не пересоздаётся |
| Редактирование без поля даты | follow-up не трогается; интервал при редактировании не применяется |
| Очистка даты при редактировании | PENDING → DISMISSED (решение: «очистка = отсутствие follow-up», скрытых follow-ups нет) |
| Уровень БД | `serviceRecordId @unique` — физически не больше одного follow-up на ServiceRecord |
| Повторный `POST .../request` | возвращает уже связанный запрос (200, `created: false`), новый не создаётся |
| Гонка двух одновременных `POST .../request` | связывание — условный `UPDATE ... WHERE customerRequestId IS NULL AND status IN (PENDING, CONTACTED)`, побеждает ровно один; проигравший получает запрос победителя (ограничение в §15) |
| BOOKED / DISMISSED без запроса | 400, запрос не создаётся |

### 10. Tenant Isolation

- Все запросы репозитория идут через `withTenant(tenantId, { businessId, ... })`.
- Чужой follow-up даёт `404 NOT_FOUND` и на GET, и на PATCH, и на POST request; существование объекта не раскрывается.
- Operations, Client Detail и Vehicle Detail используют тот же scoped list.

Покрытие тестами:
- **`tests/tenantIsolation.test.ts`** (существующий набор, +6 тестов): GET by id, PATCH, связывание запроса, list с фильтрами (Operations / Client / Vehicle), поиск по serviceRecordId, переход в BOOKED.
- **Браузер, через реальный HTTP:** зарегистрирован второй тенант. GET, PATCH и POST request на чужой follow-up дают 404, список пуст, follow-up тенанта A не изменился.

### 11. Tests

| | Файлов | Тестов |
|---|---|---|
| **До** | 62 | **1229** |
| **После** | 65 | **1318** (+89) |

Новые файлы:
- `tests/serviceFollowUpService.test.ts` (48): Case A/B/C, отсутствие дублей, обновление PENDING, защита CONTACTED/BOOKED/DISMISSED, очистка даты, вся матрица переходов (5 разрешённых + 7 запрещённых), «Отложить», 404, создание запроса (клиент, автомобиль, услуга, `MANUAL`, `NEW`, subject, note), запрос без услуги, идемпотентность (в том числе после BOOKED и при гонке), отказ для BOOKED/DISMISSED, валидация через обычный путь запроса, BOOKED при CONVERTED, исторический ServiceRecord без appointment, отклонённый ServiceRecord не создаёт follow-up, DST Europe/Berlin (обе смены), граница суток Europe/Moscow.
- `tests/followUpQueue.test.ts` (10): окно Operations (просрочено / сегодня / +7 входят, +8 нет), граница — полночь бизнеса, DST внутри окна, бейджи, сортировка, подсказанная дата формы.
- `tests/serviceFollowUp.schemas.test.ts` (25): `repeatIntervalDays` (null, 180, отказ для 0 / −30 / 1.5 / строк), дата `YYYY-MM-DD` (отказ для 2026-02-30 и др.), `followUpDueDate` (`""` / `null` / отсутствует), только 4 статуса, PATCH отбрасывает лишние ключи.
- `tests/tenantIsolation.test.ts` (+6), см. §10.

Изменения существующих тестов: в `serviceRecordService.test.ts` и `customerRequestService.test.ts` добавлен только **no-op stub** нового `serviceFollowUpRepository`, потому что их сервисы теперь вызывают его после сохранения. Ни одна существующая проверка не удалена и не ослаблена.

### 12. Browser Validation

Проведена в headless Chromium (Playwright) против dev-сервера на **локальной PostgreSQL 17** с применённой миграцией, потому что рабочая Supabase недоступна. `.env` не менялся, использовались только переменные окружения процесса. Результат: **53 / 53 проверки PASS**. Скриншоты сохранены во временной папке сессии.

- **Вход:** launch screen → «Начать работу» → форма входа → `/dashboard`; auth без изменений.
- **Scenario A (интервал):**
  - в UI «Услуги» задано 180 дней; значение 0 блокируется браузером, 0 и 1.5 сервер отклоняет с 400;
  - запись создана и переведена через UI (IN_PROGRESS → COMPLETED);
  - по ссылке «Добавить результат» открыта форма; «Следующий контакт» = сегодня + 180 (2027-03-28);
  - после Save создан ровно один PENDING, `dueAt` = 2027-03-27T21:00Z (полночь по Москве); клиент, автомобиль и услуга скопированы;
  - в окне Operations follow-up не показан (он через 180 дней), в карточке клиента показан 28.03.2027;
  - повторное сохранение записи не создало дубль.
- **Scenario B (ручная дата):** форма предложила «+180», пользователь указал «сегодня + 3»; после дальнейших правок дата не пересчиталась; сохранена ручная дата.
- **Исторический ServiceRecord без appointment:** принят, follow-up создан.
- **Operations:** порядок «просрочен → сегодня → скоро» верный; бейджи, клиент, автомобиль, услуга, дата и статус видны. Vehicle Detail показывает ближайший PENDING.
- **Scenario C (обращение):**
  - «Создать обращение» → плашка «Обращение создано», строка ушла из очереди;
  - follow-up CONTACTED и связан; запрос: клиент, автомобиль и услуга верные, `source = MANUAL`, `status = NEW`;
  - повторный вызов вернул тот же запрос (200), количество запросов 1 → 1;
  - запрос виден в рабочей очереди.
- **Scenario D (не требуется):** строка ушла, статус DISMISSED; DISMISSED → PENDING даёт 400 `INVALID_STATUS_TRANSITION`; запрос из DISMISSED не создаётся (400).
- **Scenario E (отложить):** новая дата «сегодня + 5» сохранена, статус PENDING, бейдж «Просрочен» исчез. Карточка клиента обновила ближайший контакт.
- **BOOKED:** запрос прошёл IN_PROGRESS → QUALIFIED (+ appointment) → CONVERTED, follow-up стал BOOKED.
- **Tenant isolation:** см. §10.
- **Mobile 390 px:** в Operations нет горизонтального скролла.
- **Консоль:** ошибок страницы нет. Были только уже существующие `401` от `/api/auth/me` на `/login` и `404` для `/favicon.ico` (в проекте нет favicon). Все `/api` запросы страницы, кроме `auth/me`, прошли без ошибок.

Один из промежуточных прогонов дал сбой в шаге A: тогда я пересоздал схему БД под работающим dev-сервером. После перезапуска сервера на чистой БД полный прогон прошёл 53 / 53, включая этот шаг.

### 13. Regression Validation

Фактически выполнено после финальных правок:

| Проверка | Результат |
|---|---|
| `npm run typecheck` | **PASS** (без ошибок) |
| `npm run build` | **PASS** (1644 modules; есть предупреждение о размере чанка, оно существовало и раньше) |
| `npm test` | **PASS — 1318 / 1318**, 65 файлов |
| `npx prisma validate` | **PASS** |

Существующие защиты сохранены и покрыты тестами:
- CANCELLED / NO_SHOW для ServiceRecord;
- переходы Appointment и lifecycle CustomerRequest (CONVERTED по-прежнему требует appointment);
- согласованность клиент / автомобиль / услуга;
- архивирование;
- существующая очередь Operations и фильтры дат;
- вывод Lead из эксплуатации (`leadRetirement.test.ts` зелёный).

### 14. Git

- Ветка `master`; один локальный коммит `feat: add service follow-up retention loop`; hash указан в ответе в чате.
- **Push не выполнялся.** GitHub, remote и default branch не менялись.
- Неотслеживаемые `.mcp.json` и `marketing/` не тронуты (они в `.gitignore`).

### 15. Known Limitations

1. **Миграция не применена к рабочей Supabase.** База недоступна (`P1001`), MCP без токена. Когда база вернётся, нужно выполнить `npx prisma migrate deploy`. **Важно для деплоя:** код без миграции упадёт на создании и изменении услуг (колонки `repeatIntervalDays` нет) и на `/api/follow-ups`. Сначала миграция, потом код.
2. **ServiceRecord и follow-up пишутся не одной транзакцией.** Follow-up создаётся после успешного сохранения записи. Если сама запись follow-up упадёт, API вернёт ошибку, хотя ServiceRecord уже сохранён, и пользователь может сохранить запись повторно. Существующие репозитории не принимают транзакционный клиент; менять это вне scope.
3. **Гонка двух одновременных «Создать обращение».** Связывание атомарно, дубля связи нет, но проигравший вызов уже успел создать `CustomerRequest`, и этот запрос останется без связи с follow-up. Кнопка блокируется на время запроса, так что через UI это практически недостижимо.
4. **Ручной `PATCH status: BOOKED` разрешён матрицей** (PENDING/CONTACTED → BOOKED, как требует §6) и не требует подтверждения appointment. В UI такой кнопки нет; BOOKED ставится автоматически при CONVERTED.
5. **Архивирование ServiceRecord не закрывает его follow-up.** Осознанно не расширял scope.
6. **Очередь Operations загружает до 100 follow-ups** (как соседние секции, `pageSize=100`); при большем числе в окне лишние не показываются.
7. **Не исправлено, известно из Prompt 47:**
   - ServiceRecord можно привязать к IN_PROGRESS записи, которую потом отменяют (теперь в этом случае может остаться и PENDING follow-up);
   - нет учёта ёмкости сервиса;
   - нет billing;
   - нет связи разговора с запросом в UI.

   Всё это вне scope Prompt 48.
8. **Где проверено.** Браузерная проверка и применение миграции выполнены на локальной PostgreSQL 17, а не на Supabase. Путь `migrate deploy` через всю историю миграций на пустой БД не проверялся из-за давнего дефекта порядка миграций (см. final-report-44).
