# Prompt 41 — Operational Lifecycle Integrity Audit

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# Prompt 41 — Operational Lifecycle Integrity Audit

Ты работаешь в существующем проекте Autoservise.

ВАЖНО:
- НЕ переписывай архитектуру.
- НЕ создавай новые модели, если существующая модель уже решает задачу.
- НЕ создавай дублирующие API, страницы, DTO или бизнес-логику.
- Сначала проведи аудит существующего кода, затем исправляй только подтверждённые реальные gaps.
- Не делай redesign.
- Не добавляй AI/LLM.
- Не добавляй Telegram/WhatsApp/Avito/VK/MAX.
- Не добавляй CRM, SMS, payments, voice AI.
- Не меняй auth/tenant architecture.
- Не меняй Prisma schema без доказанной необходимости.
- Не меняй существующие статусы Appointment.
- Не меняй механику создания Appointment.
- Не трогай .mcp.json.
- Не трогай marketing/.
- Не трогай origin/main.
- Работай только с текущей веткой master.

## Контекст

Проект уже прошёл Prompts 33–40.

Текущее состояние:
- TypeScript PASS
- Build PASS
- Tests 1260/1260
- Prompt 33: Service Completion Visibility
- Prompt 34: Appointment Creation
- Prompt 35: Appointment List & Date Navigation
- Prompt 36: Operations Daily Work Queue
- Prompt 37: Request → Appointment Operational Flow Audit
- Prompt 38: Post-Service Follow-up & Next Action Audit
- Prompt 39: Client Service History & Retention Flow Audit
- Prompt 40: Dashboard Operational Truth Audit

Существующий operational flow:

Request
→ Appointment
→ Service execution
→ COMPLETED
→ ServiceRecord
→ Service History
→ Recommendations / next action
→ future service / repeat visit

Нужно проверить именно ЦЕЛОСТНОСТЬ этого жизненного цикла.

---

# 1. Сначала проведи read-only аудит

НЕ ИСПРАВЛЯЙ КОД, пока не составишь карту существующего flow.

Проверь реальные implementation points:

### CustomerRequest

Найди:
- Prisma model
- API endpoints
- Request Detail
- status transitions
- appointmentId
- customerId
- vehicleId
- serviceId, если существует
- где request создаётся
- где request закрывается
- какие статусы считаются активными

Проверь:

Request → Appointment

и

Appointment → originating Request.

Убедись, что используется существующая связь:

CustomerRequest.appointmentId

и не создаётся альтернативная связь.

---

# 2. Appointment lifecycle

Проверь реальные переходы:

SCHEDULED
→ CONFIRMED
→ IN_PROGRESS
→ COMPLETED

и допустимые exits:

CANCELLED
NO_SHOW

Проверь:

- где разрешены переходы;
- существуют ли серверные проверки;
- можно ли выполнить невозможный переход через API;
- что происходит с linked CustomerRequest;
- что происходит с ServiceRecord.

Особенно проверить:

### COMPLETED

Что реально происходит после:

Appointment.status = COMPLETED

Проверь, что ServiceRecord НЕ создаётся автоматически без результата обслуживания.

Это важно сохранить.

---

# 3. ServiceRecord lifecycle

Проверь существующую модель и API.

Не меняй schema.

Проверь:

- appointmentId
- vehicleId
- serviceId
- performedAt
- mileage
- workDescription
- partsDescription
- recommendations
- totalPrice
- currency

Проверь серверные проверки:

- tenant ownership
- appointment consistency
- vehicle/customer consistency
- mileage monotonicity
- допустимость ServiceRecord для Appointment status

Особенно ответь:

1. Может ли ServiceRecord быть создан для CANCELLED?
2. Может ли ServiceRecord быть создан для NO_SHOW?
3. Может ли ServiceRecord быть создан до COMPLETED?
4. Может ли один Appointment получить несколько ServiceRecord?
5. Может ли ServiceRecord принадлежать чужому tenant?
6. Может ли ServiceRecord связать Appointment с чужим vehicle/service?

Если какая-то из этих ситуаций уже корректно блокируется — НЕ меняй.

Если обнаружен реальный security/business-logic gap — исправь минимально существующим механизмом.

---

# 4. Проверка service history

Проверь:

/settings/service-history

Client Detail

Vehicle Detail

Appointment Detail

Проверь, что одна и та же ServiceRecord отображается согласованно.

Для каждой точки проверь:

- vehicle
- service
- mileage
- performedAt
- price
- currency
- recommendations
- appointment link

Особенно проверь, что UI не показывает историю, которая не принадлежит текущему tenant/client/vehicle.

Не создавать новый history endpoint.

---

# 5. Повторное обслуживание / retention loop

Это КЛЮЧЕВАЯ часть Prompt 41.

Проверь существующую семантику:

ServiceRecord.recommendations

и использование рекомендаций после завершённого обслуживания.

Нужно выяснить:

- где менеджер видит recommendation;
- может ли он перейти к клиенту/автомобилю;
- может ли создать следующий Request;
- может ли создать следующий Appointment;
- сохраняется ли связь с тем же customer/vehicle;
- не создаётся ли новая сущность с неправильным customer/vehicle;
- не теряется ли контекст предыдущего обслуживания.

НЕ создавай автоматические follow-ups.

НЕ создавай CRM automation.

Нужно только проверить, что существующие ручные действия позволяют продолжить lifecycle.

---

# 6. Проверка "закрытого" lifecycle

Проверь, что завершённые сущности не продолжают ошибочно попадать в рабочие очереди.

Проверить:

/operations

/dashboard

/requests

/appointments

/escalations

Для:

COMPLETED
CANCELLED
NO_SHOW
CLOSED
CANCELLED request

Проверь:

- active queue;
- KPI;
- lists;
- empty states;
- status filters;
- date filters.

Особенно:

COMPLETED appointment

не должен попадать в:

"Сегодняшние записи" как active work.

И:

CANCELLED / NO_SHOW

не должны выглядеть как предстоящая работа.

---

# 7. Cross-screen consistency matrix

Составь фактическую таблицу:

| Entity | Screen | Source | Status/date semantics | Tenant scope | Navigation |
|---|---|---|---|---|---|
| Request | /requests | ... | ... | ... | ... |
| Request | /operations | ... | ... | ... | ... |
| Appointment | /appointments | ... | ... | ... | ... |
| Appointment | /operations | ... | ... | ... | ... |
| Appointment | /dashboard | ... | ... | ... | ... |
| ServiceRecord | Client Detail | ... | ... | ... | ... |
| ServiceRecord | Vehicle Detail | ... | ... | ... | ... |
| ServiceRecord | Appointment Detail | ... | ... | ... | ... |
| ServiceRecord | Service History | ... | ... | ... | ... |

Ищи только реальные противоречия.

---

# 8. Особый security audit

Проверь все write endpoints:

CustomerRequest
Appointment
ServiceRecord

на tenant isolation.

Особенно cross-entity attack scenarios:

Tenant A:
- Appointment A

Tenant B:
- Vehicle B

Попытка создать:

ServiceRecord(
  appointmentId=A,
  vehicleId=B
)

или:

ServiceRecord(
  appointmentId=A,
  serviceId=B
)

или:

Appointment(
  customerId=A,
  vehicleId=B
)

Должны корректно блокироваться.

Не создавай новый authorization framework.

Используй существующие:

withTenant(...)
assertRelationsOwnedAndActive(...)
assertAppointmentConsistency(...)
и аналогичные helpers.

---

# 9. Existing data audit

Если в текущей dev DB уже есть данные:

НЕ создавай новые записи.

Используй существующие.

Проверь хотя бы один существующий lifecycle:

Customer
→ Vehicle
→ Service
→ Appointment
→ COMPLETED
→ ServiceRecord
→ History

Если такой цепочки нет, честно укажи это в Final Report.

НЕ создавай фиктивные данные только ради теста.

---

# 10. Decision

После аудита классифицируй результат:

### Outcome A
Lifecycle уже целостный.
Изменений не требуется.

### Outcome B
Есть небольшой UX gap.
Исправить минимально.

### Outcome C
Есть реальный business/security/data-consistency gap.
Исправить минимально.

Если найден gap — сначала объясни:
- почему это действительно gap;
- где находится;
- почему существующая архитектура не решает его.

Только после этого внеси минимальное исправление.

---

# 11. Tests

После изменений:

1. TypeScript
2. Build
3. полный существующий test suite

Не снижать покрытие.

Если добавляешь тесты — только для реально найденного поведения.

---

# 12. Manual validation

Если был UI change:

используй Playwright.

Проверь:
- страницу;
- navigation;
- URL;
- loading;
- empty state;
- console;
- network errors.

Если populated data отсутствует — не имитируй успешную проверку. Честно укажи limitation.

---

# 13. Regression

Проверь, что не сломаны:

Prompt 33 — Service Completion Visibility
Prompt 34 — Appointment Creation
Prompt 35 — Appointment Date Navigation
Prompt 36 — Operations Today
Prompt 37 — Request ↔ Appointment
Prompt 38 — Recommendations
Prompt 39 — Service History
Prompt 40 — Dashboard

Особенно НЕ сломать:

- Appointment creation
- startAt date semantics
- Operations active appointment logic
- serviceCompletionState()
- ServiceRecord history
- recommendation visibility
- Dashboard appointment KPI

---

# 14. Git

Если изменений НЕТ:
- никаких commits.

Если изменения ЕСТЬ:
- сделай один feature/fix commit;
- затем отдельный docs commit;
- НЕ push.

Не трогай:
- .mcp.json
- marketing/
- origin/main

---

# 15. Final Report

Ответь строго структурировано:

## Final Report — Prompt 41: Operational Lifecycle Integrity Audit

### 1. Audit Result
Outcome A / B / C

### 2. CustomerRequest Audit

### 3. Appointment Lifecycle Audit

### 4. ServiceRecord Audit

### 5. Service History Audit

### 6. Retention / Repeat Service Audit

### 7. Closed Lifecycle / Queue Audit

### 8. Cross-Screen Consistency

### 9. Security / Tenant Isolation

### 10. Implementation
Что конкретно изменено и почему.

### 11. Validation
TypeScript:
Build:
Tests:

### 12. Manual Validation
Что реально проверено.
Что невозможно проверить.

### 13. Regression
Prompts 33–40.

### 14. Git
Branch:
Commits:
Push:
Working tree:

STOP after Final Report.
