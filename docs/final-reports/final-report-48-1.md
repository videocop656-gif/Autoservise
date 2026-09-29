## Final Report — Prompt 48.1: Production Hardening + Supabase Migration

**Итог: PASS.** Работа сначала была заблокирована: Supabase недоступна, `P1001`. Пользователь восстановил проект (статус Healthy), и работа продолжена с точки блокировки:
- миграция Prompt 48 применена к основной Supabase безопасным путём;
- схема и сохранность данных проверены;
- браузерная проверка на Supabase прошла **62 / 62**.

Push и deploy не выполнялись; Prompt 49 не начинался.

| AC | Статус | AC | Статус |
|---|---|---|---|
| AC1 Supabase доступна | ✅ после восстановления | AC10 поведение Prompt 48 сохранено | ✅ |
| AC2 история миграций проверена | ✅ | AC11 TypeScript | ✅ |
| AC3 миграция применена (`migrate deploy`) | ✅ | AC12 Build | ✅ |
| AC4 данные не потеряны | ✅ счётчики до и после идентичны | AC13 все тесты | ✅ 1344/1344 |
| AC5 атомарность | ✅ | AC14 браузер на Supabase | ✅ 62/62 |
| AC6 нет дублей и сирот | ✅ | AC15 один локальный коммит | ✅ |
| AC7 BOOKED только с appointment | ✅ | AC16 ничего не запушено | ✅ |
| AC8 архив → DISMISSED | ✅ | AC17 dev-сервер и URL | ✅ `http://localhost:5173` |
| AC9 tenant isolation | ✅ | | |

### 1. Initial state
- Начало 48.1: `HEAD` = `ff88d90`, дерево чистое, 1318 тестов.
- Продолжение: `HEAD` = коммит Prompt 48.1, дерево чистое; в приложении ничего не менялось.

### 2. Supabase connectivity
| Когда | Проверка | Результат |
|---|---|---|
| Первая попытка | `prisma migrate status` | `P1001`; пулер отвечал `tenant/user … not found` (проект на паузе) |
| После восстановления | `prisma migrate status` через `.env` `DIRECT_URL` | подключение есть |

Секреты не выводились; `.env` не изменялся.

### 3. Migration status before
Read-only проверка `_prisma_migrations` и файлов миграций:
- применено **14** миграций, локально **15**; незавершённых или откатанных — **0**;
- применённых без локального файла — **0**; расхождений контрольных сумм (sha256 `migration.sql`) — **0**;
- не применена **только** `20260929120000_service_follow_up_retention_loop`;
- её объектов в БД ещё нет (таблица, enum, колонка) — частичного применения не было.

Вывод: история последовательна, `migrate resolve` не нужен и не использовался.

### 4. Migration deployment
`npx prisma migrate deploy` → «All migrations have been successfully applied» (одна миграция). Затем:
- `prisma migrate status` → **«Database schema is up to date!»**;
- `prisma validate` → valid.

Никаких reset / push `--force-reset` / DROP / TRUNCATE / DELETE.

### 5. Post-migration verification (фактическая схема Supabase)
- `services."repeatIntervalDays"` — integer, nullable.
- `service_follow_ups` — 13 колонок, как в схеме.
- enum `ServiceFollowUpStatus` = PENDING, CONTACTED, BOOKED, DISMISSED.
- Индексы: pkey, **unique `serviceRecordId`**, `[tenantId, businessId, status, dueAt]`, варианты с customer и vehicle, `customerRequestId`.
- CHECK `("repeatIntervalDays" IS NULL) OR ("repeatIntervalDays" > 0)`.
- 7 внешних ключей: tenant, business, customer, vehicle, service, serviceRecord, customerRequest.
- `prisma migrate diff` от живой БД к `schema.prisma` — **пусто** (дрейфа нет).

### 6. Data safety verification
Read-only подсчёт строк до миграции, сразу после неё и в конце. В конце — без учёта тестовых тенантов проверки из §15:

| Таблица | tenants | businesses | users | customers | vehicles | services | appointments | service_records | customer_requests | conversations |
|---|---|---|---|---|---|---|---|---|---|---|
| До миграции | 2 | 2 | 2 | 1 | 1 | 3 | 1 | 1 | 2 | 3 |
| После миграции | 2 | 2 | 2 | 1 | 1 | 3 | 1 | 1 | 2 | 3 |
| В конце (исходные данные) | 2 | 2 | 2 | 1 | 1 | 3 | 1 | 1 | 2 | 3 |

Все три строки **идентичны**. У исходных тенантов нет follow-ups и не задан интервал ни у одной услуги — их данные не затронуты.

### 7. Atomicity fix
- ServiceRecord create / update / archive и изменение его follow-up выполняются в **одной транзакции** (`runInTransaction` поверх существующего `prisma.$transaction`; необязательный `tx` у затронутых методов репозиториев). Всё фиксируется или всё откатывается.
- `CONVERTED → BOOKED` выполняется внутри транзакции смены статуса запроса.
- Все правила Prompt 48 сохранены.

### 8. Concurrency fix
Сначала все чтения и валидация (`prepareCustomerRequestCreate`). Затем короткая транзакция только через свой `tx`: `SELECT … FOR UPDATE` строки follow-up (с учётом тенанта), повторная проверка, вставка запроса, связывание.

Найден и исправлен собственный дефект: чтения внутри заблокированной транзакции брали второе соединение пула, что при параллельных вызовах давало 500 по таймауту пула.

Проверка реального сервисного кода, 10 параллельных вызовов на один follow-up:

| Где | Режим | Результат |
|---|---|---|
| Локальная PostgreSQL | пул 1 и пул 5 | 10/10 успешно, 1 запрос, 0 ошибок |
| **Supabase** | **transaction pooler** (`.env` `DATABASE_URL`, `pgbouncer=true`) | **10/10, 1 запрос, 1 id, 0 сирот**, CONTACTED; 22 с из-за задержки пулера, без таймаутов |
| **Supabase** | HTTP через dev-сервер, 10 параллельных | 1×201 + 9×200, 1 запрос, 1 id |

### 9. BOOKED invariant
Ручной BOOKED возможен только при связанном запросе в CONVERTED с существующим appointment того же тенанта; иначе `400 FOLLOW_UP_NOT_BOOKED`. На Supabase подтверждено: ручной BOOKED → 400, follow-up остаётся PENDING; CONVERTED с appointment → BOOKED.

### 10. Archive behavior
Архивирование ServiceRecord переводит PENDING в DISMISSED в той же транзакции; CONTACTED, BOOKED и DISMISSED не меняются. На Supabase подтверждено:
- архивирование через UI → follow-up DISMISSED;
- архивирование записи с CONTACTED follow-up → остаётся CONTACTED.

### 11. Tenant isolation
- Все новые пути ограничены tenant + business.
- На Supabase «чужой» тенант получил 404 на GET, PATCH и POST request; его список пуст; follow-up тенанта A не изменился.
- Тесты: `tenantIsolation.test.ts` (row lock) и блок изоляции в `serviceFollowUpHardening.test.ts`.

### 12. Tests
**1318 → 1344** (+26), 66 файлов:
- новый `serviceFollowUpHardening.test.ts` (26) — модель транзакции честно откатывает состояние; мутационная проверка подтвердила, что тесты ловят регрессии;
- существующие тесты адаптированы без ослабления.

Подробности в разделе 12 первой версии отчёта (в истории коммита).

### 13. Typecheck
`npm run typecheck` — **PASS** (0 ошибок).

### 14. Build
`npm run build` — **PASS**. `npm test` — **1344 / 1344 PASS**. `prisma validate` — **PASS**.

### 15. Browser validation — на основной Supabase: **62 / 62 PASS**
Headless Chromium против dev-сервера, подключённого к **основной Supabase**.

Чтобы не трогать реальные данные, проверка шла в **отдельных тестовых тенантах**, зарегистрированных штатным `/register`:
- `p48-1-check4@example.com` — полный прогон;
- `p48-1-check`, `-check2`, `-check3` — ранние прогоны, остались с частичными данными;
- «Проверка P48.1 — чужой тенант» (`other…@example.com`) — для проверки изоляции.

Существующие услуги, часовой пояс и рабочие часы реальных тенантов не менялись. Ничего не удалялось.

Результаты:
- **A (интервал):**
  - в UI задано 180 дней; 0 блокируется браузером, 0 и 1.5 сервер отклоняет с 400;
  - запись переведена в COMPLETED через UI; подсказана дата «сегодня + 180»;
  - создан ровно один PENDING, `dueAt` = полночь по Москве; копии клиента, авто и услуги верны;
  - в 7-дневном окне Operations не показан (он через 180 дней); в карточке клиента дата видна; повторное сохранение без дубля.
- **B (ручная дата):** ручная дата победила интервал; исторический ServiceRecord без appointment тоже получает follow-up.
- **Operations:** порядок «просрочен → сегодня → скоро», бейджи и содержимое строк верны.
- **C (обращение):** запрос с верными клиентом, авто и услугой, `MANUAL` / `NEW`; повтор без дубля (1 → 1); запрос виден в очереди.
- **D (конверсия):** запрос CONVERTED с реальным appointment → follow-up **BOOKED**; «Не требуется» → DISMISSED; DISMISSED → PENDING даёт 400.
- **E (архив):** архивирование записи с PENDING → **DISMISSED**; «Отложить» сохраняет PENDING.
- **F (карточки):** Client Detail и Vehicle Detail показывают верный ближайший PENDING.
- **48.1 hardening:** ручной BOOKED → 400; 10 параллельных HTTP-запросов → один запрос; архив → DISMISSED; CONTACTED при архиве не меняется.
- **Tenant isolation:** 404 на GET, PATCH и POST для чужого тенанта.
- **Mobile 390 px:** нет горизонтального скролла.
- **Консоль:** ошибок нет. Были только давние `401 /api/auth/me` на `/login` и `404 /favicon.ico`. Все `/api` запросы страниц прошли без ошибок.

**Важная находка по среде (не код Prompt 48/48.1):**

| Подключение | Один `SELECT 1` |
|---|---|
| **transaction pooler** Supabase (порт 6543, `pgbouncer=true`) — его использует приложение по `.env` `DATABASE_URL` | **~1100 мс** |
| session pooler (порт 5432, `DIRECT_URL`) | ~225 мс |

Последствия:
- при transaction pooler один авторизованный запрос занимает ~5–6 с;
- `/operations` (≈11 одновременных запросов при пуле 5) упирается в таймаут пула 10 с, и падает давний список эскалаций (`aiEscalation.findMany/count`).

Поэтому браузерная проверка шла на **той же Supabase через session-подключение** (только переменная окружения процесса, `connection_limit=10&pool_timeout=60`). Корректность блокировок **в продакшн-режиме transaction pooler** проверена отдельно (§8).

Первые три прогона не прошли из-за таймингов тестового скрипта при медленной БД, а не из-за продукта: сохранения фиксировались позже, чем скрипт переходил дальше. Скрипт переведён на ожидание фактического завершения запросов, после чего прошёл 62 / 62.

Кириллические названия, отправленные через `curl` из консоли Windows, сохранились с испорченной кодировкой. Это касается только тестовых тенантов; их имена исправлены штатными API (`PATCH /api/business`, `PATCH /api/team/:id`).

### 16. Known limitations remaining
1. **Производительность подключения (рекомендация, решение за пользователем).** Transaction pooler даёт ~1.1 с на запрос. Варианты:
   - для постоянно работающего сервера — session pooler (порт 5432);
   - или увеличить `connection_limit` / `pool_timeout` в `DATABASE_URL`;
   - или разместить приложение ближе к региону БД (ap-northeast-1).

   `.env` не менялся.
2. **BOOKED не учитывает статус appointment** (отменённый тоже засчитывается) — согласовано с автоматическим путём Prompt 48.
3. **Редкий 409** при изменении follow-up между проверкой и блокировкой; достаточно повторить.
4. **Тестовые тенанты проверки остаются в БД:** 4 × «Проверка P48.1 (тест N)» и «Проверка P48.1 — чужой тенант». Удаление запрещено этим prompt; их можно удалить отдельно, если нужно.
5. **Не исправлялось по §12:** IN_PROGRESS → CANCELLED при существующем результате; ёмкость; billing; связь разговора с запросом в UI; период Dashboard в URL; фронтенд-тесты; лимит 100 в очереди Operations.

### 17. Git status
- Один локальный коммит Prompt 48.1 `fix: harden service follow-up retention loop` поверх `ff88d90`; этот отчёт включён в него.
- `master` на 2 коммита впереди `origin/master`.
- **Push не выполнялся**; GitHub не менялся.

### 18. Local URL
`http://localhost:5173` — dev-сервер оставлен запущенным и подключён к **основной Supabase** (через session-подключение, см. §15).

Для скриншотов:
- вход в тестовый тенант с полным набором данных проверки: `p48-1-check4@example.com` (пароль передан в чате);
- или ваша собственная учётная запись — там follow-ups пока нет.
