# Phase 2N.4.3 v5 payment migration package

Status: REVIEW DRAFT. Nothing has been executed. No SQL, migration, database change, Stripe operation, or application edit has been made. Awaiting independent review and explicit approval.

This package supersedes `db/review/phase2n4-3-v4/`. That draft was never applied. Its folder should be deleted in the release commit, after approval, so the tree has one design.

## Files

- `01_forward.sql`: forward migration, built on the live base (`20261011120000`, `20261011130000`).
- `02_rollback.sql`: archives every v5-only record with per-row md5, then restores the pre-v5 shape.
- `03_tests.sql`: single-session behaviour tests T1 to T7.
- `04_concurrency.test.mjs`: two-connection tests C1, C2, W1, R1.

## Verified facts (read from the repository)

- Live `booking_attempts` has `expected_amount INTEGER`, `currency VARCHAR(3) DEFAULT 'eur'`, a status CHECK, and a unique `payment_intent_id`. Migrations `20261011120000` and `20261011130000` define these.
- `webhook_events` has a unique `stripe_event_id` and no provider column.
- `rides` has `payment_intent_id` with a partial unique index.
- The Stripe create route sends `Math.round(amount * 100)` with currency `eur`. It is EUR-cents, not XAF. This does not match the agreed convention and must change in the same release.
- The ride insert in `src/lib/ride-service.ts` stores `fare_price` as the PaymentIntent amount in cents. It must store minor units of the booking currency.
- `formatXaf` in `src/lib/utils.ts` is display-only and needs no change.
- Verified by read-only query on the Neon database (2026-11-06): 2 rides, both `payment_status = 'paid'`, no `payment_intent_id`, `fare_price` 15500.00 and 23000.00 (whole XAF units, stored as `numeric(10,2)`), and no currency column. 0 `booking_attempts` rows and 0 `webhook_events` rows.

## Assumptions to verify before any run

1. Column names and NOT NULL columns of `rides` (user_id, origin/destination fields, ride_time, driver_id, fare_price, payment_status, and any ride_status or similar). `create_ride_from_booking` and `confirm_cash_booking` insert into `rides` with these names. Verify with a schema read on the disposable branch first.
2. `drivers.id` is an integer that matches `booking_attempts.driver_id`.
3. `rides.payment_status` exists and is text.
4. Whatever column identifies the driver's authenticated account is resolved by the backend before calling `record_cash_collection`. The database trusts the driver id it is given.

## Amount convention

- Every amount column holds an integer in the minor units of its currency.
- XAF: exponent 0. One franc equals one unit. Never multiplied by 100.
- EUR: exponent 2. Cents. Stripe receives cents for EUR.
- `payment_transactions`, `cash_collections`, `refund_requests` and `booking_attempts` reject any currency other than `XAF` or `EUR`.
- Conversion to Stripe happens in one helper in the backend: `XAF` sends the integer as-is, `EUR` sends the value times 100. No other code converts.

### Currency review (every conversion site)

| Location | Current behaviour | Required v5 behaviour |
|---|---|---|
| `src/app/(api)/(stripe)/create+api.ts` | Multiplies by 100, currency `eur` | Single helper: XAF as-is with currency `xaf`; EUR times 100 with currency `eur` |
| `create+api.ts` line ~136 | Compares `expected_amount` to a cents value | Compares minor units of the booking currency |
| `webhook+api.ts` | Not yet read in full | Compare the event amount and currency with the booking, same units |
| `src/lib/ride-service.ts` | Stores `fare_price` as cents | Stores minor units of the booking currency |
| `booking+api.ts` | Not yet read in full | Server computes the amount; client amount is never trusted |
| `src/lib/utils.ts` `formatXaf` | Display only | No change |
| Database | `expected_amount` INTEGER, default `eur` | Minor units; currency CHECK `XAF`/`EUR`; default `XAF` |

Pre-v5 rows: none exist in `booking_attempts`, so no amount reinterpretation is needed. The two existing rides keep their stored `fare_price` unchanged and are marked `legacy_unknown` (see below).

## Legacy classification

- The two existing rides get `payment_classification = 'legacy_unknown'`.
- They are not assumed to be cash. Their `payment_method_code` stays NULL, their `payment_intent_id`, `payment_currency`, `fare_price` and `payment_status` stay as recorded, and `rides_enforce_payment_rules` skips them.
- A trigger rejects any update that changes their classification, method, PaymentIntent, currency or fare. Status fields are not included in the trigger, so a later support action can still correct their settlement status.
- No payment transaction rows are created for them. History is kept as stored.
- The `legacy_unknown` method exists only in `payment_methods` with `is_active = false`, so no new booking can select it.

## Payment methods

| Code | Requires PaymentIntent | Allows no intent | Active |
|---|---|---|---|
| `card_stripe` | yes | no | yes |
| `cash` | no | yes | yes |
| `legacy_unknown` | no | yes | no |
| `mtn_momo` (reserved) | no | no | no |
| `orange_money` (reserved) | no | no | no |

- A ride with a PaymentIntent requires a method that requires one. A ride without one requires a method that allows none.
- Adding MTN or Orange later means activating a row and adding a provider reference. Provider references are not per-column; `payment_transactions` stores `provider` and `provider_ref`. The `provider` CHECK must be widened for each new provider, which is a small change and not a table migration.

## Independent status dimensions

- Ride status: the existing trip lifecycle column. Not changed by v5.
- Payment status (`rides.payment_status`): `unpaid`, `cash_pending`, `cash_collected`, `paid`, `failed`, `refunded`, `disputed`, `held_for_review`.
- Settlement status (`rides.settlement_status`): `not_applicable`, `pending`, `settled`, `held`. Only the settlement value is changed when cash is collected. Driver payouts are not modelled in v5.
- The three are independent. No trigger links them, except the legacy immutability rule.

## Card state matrix (`booking_attempts.status`)

| From | Event | To | Side effects |
|---|---|---|---|
| `pending` | `link_payment_intent` (amount and currency match) | `payment_intent_created` | none |
| `payment_intent_created` | `payment_intent.amount_capturable_updated` | `authorized` | ledger `authorization` |
| `payment_intent_created` or `authorized` | `payment_intent.succeeded` | `succeeded` | ledger `charge`, ride created with `paid` |
| `authorized` | `payment_intent.canceled` | `released` | ledger `release`; no refund |
| `payment_intent_created` | `payment_intent.canceled` | `canceled` | none |
| `payment_intent_created` | `payment_intent.payment_failed` | `failed` | none |
| `succeeded` | `charge.dispute.created` | `disputed` | ledger `dispute`; ride `disputed` |
| `succeeded` | refund completed in full | `refunded` | ride `refunded` |
| any | amount or currency mismatch | `held_for_review` | none |
| `failed` or `canceled` | late success | `held_for_review` | none |
| `released`, `canceled` | repeated cancel | no change (`already_applied`) | none |

Authorization release versus refund: a cancelled authorization (`released`) moves no money and needs no refund. A captured payment (`succeeded`) is returned only through a refund request.

## Cash state matrix

| From | Event | To | Side effects |
|---|---|---|---|
| `pending` | `confirm_cash_booking` (rider) | `cash_confirmed` | ride created, payment `cash_pending`, settlement `not_applicable` |
| `cash_confirmed` | `record_cash_collection` (assigned driver, amount and currency match, once only) | unchanged | `cash_collections` row, ledger `cash_collection`, payment `cash_collected`, settlement `pending` |
| collected | `respond_cash_collection` (rider) `acknowledged` | unchanged | rider response recorded |
| collected | `respond_cash_collection` (rider) `disputed` | unchanged | payment `held_for_review` |

Rules:
- Only the assigned driver (the backend resolves the authenticated driver and passes that driver id) may record collection. The database rejects any other driver id.
- The rider can acknowledge or dispute collection, never mark it collected.
- One collection per booking, enforced by a unique key on `cash_collections` and by the function's check.

## Refund state matrix (`refund_requests.status`)

| From | Event | Actor | To |
|---|---|---|---|
| none | `request_refund` | rider (own booking only) | `requested` |
| none | `request_refund` | system, reason `auto:driver_cancelled_before_pickup` only | `approved` |
| none | `request_refund` | support, admin | `requested` |
| `requested` | `decide_refund` | support or admin | `approved` or `rejected` |
| `approved` | `set_refund_processing` after backend creates the Stripe refund | backend | `processing` |
| `processing` | `refund.updated` succeeded, amount and currency match | Stripe webhook | `succeeded`; ledger `refund` |
| `processing` | `refund.updated` failed | Stripe webhook | `failed` |

Rules:
- Drivers may never request or decide refunds. The database rejects the role.
- Riders may request refunds only for their own booking, and only for card payments. Cash refunds are handled manually and are rejected by the database.
- Active refund requests (`requested`, `approved`, `processing`, `succeeded`) may not total more than the captured amount.
- Automatic refunds are limited to one defined rule in the database. Any other system reason is rejected.
- The database records the requester role and identity. It does not authenticate the caller. The backend must check the authenticated user and role before calling any refund function.

## Webhook and retry rules

- Each event first inserts into `webhook_events` with `ON CONFLICT DO NOTHING` on `stripe_event_id`. A repeat returns `duplicate` and changes nothing.
- An unknown PaymentIntent or refund raises `RETRYABLE`. The dedupe row rolls back, the backend returns non-2xx, and Stripe redelivers.
- A non-retryable mismatch is recorded as `held_for_review` and acknowledged.
- The ledger refuses updates and deletes. Ledger rows are unique by provider, kind and provider reference, so a repeated ledger write also fails.

## Concurrency guarantees

- Booking-level state changes lock the `booking_attempts` row (`FOR UPDATE`) before reading or writing. Two racing requests on one booking are serialised.
- A cash collection, a cash confirmation, and a refund request each run under that lock.
- Stripe events lock the attempt row. The dedupe insert happens first, so the same event cannot run twice.

## Test coverage

- `03_tests.sql`: T1 cash (confirm, wrong driver, wrong amount, collect, duplicate collect, owner check, rider dispute); T2 card (link, amount check, authorize, succeed, duplicate, replay, one ride); T3 failed then late success held; T4 authorization release with ledger check; T5 refunds (driver refused, over-refund refused, rider request, approval, processing, webhook success, replay); T6 retryable unknown PaymentIntent with no dedupe row left behind; T7 legacy immutability.
- `04_concurrency.test.mjs`: C1 double cash collection, C2 concurrent confirmation, W1 duplicate webhook deliveries, R1 refund oversubscription.
- Not covered yet: MTN and Orange (reserved), a dispute followed by a refund, and a full UI round trip.

## Rollback strategy

1. Take a Neon branch snapshot of production before the migration.
2. Run the pre-flight checks below.
3. `02_rollback.sql` refuses if any live `booking_attempts` status is outside the pre-v5 list.
4. It archives every v5-only record (`payment_transactions`, `cash_collections`, `refund_requests`, `payment_methods`, the v5 columns of `rides` and `booking_attempts`, and the audit columns of `webhook_events`) into `phase2n4_3_v5_archive`, with an md5 manifest per row.
5. It drops v5 objects and restores the pre-v5 status and currency constraints. It never drops rides, booking attempts, or webhook event rows.
6. It disables RLS on the three existing tables, matching the pre-v5 state.
7. Dropping the archive schema is a separate, approved step.

Pre-flight checks (run before any apply and again before rollback):
- The number of rides with `payment_classification = 'legacy_unknown'` equals the number recorded before the migration (2 at review time).
- `rides` payment and amount fields for legacy rows match the snapshot.
- No `held_for_review` attempts exist during rollback. If any exist, rollback waits for manual resolution.

After rollback, a `cash_collections` or `refund_requests` row cannot be restored to the live tables. Only the archive keeps them. The rollback therefore requires that no money movement happened under v5 that the business has not reconciled, which is a manual decision.

## Deployment sequence (proposed)

1. Approve this package and the open decisions below.
2. Verify the assumptions on a disposable Neon branch: read the `rides`, `drivers` and `booking_attempts` column definitions.
3. Apply `01_forward.sql` to the disposable branch. Run `03_tests.sql` and `04_concurrency.test.mjs` with `TEST_DATABASE_URL`.
4. Take a production snapshot.
5. Apply `01_forward.sql` to production in a maintenance window, with no live Stripe traffic.
6. Deploy the application changes in the same release (list below), including the currency helper.
7. Re-enable card payments only after a test card transaction is reconciled in the ledger.
8. Watch `webhook_events` for `RETRYABLE` results and `held_for_review` counts.

## Application files that must change in the same release

- `src/app/(api)/(stripe)/create+api.ts`: currency helper, XAF as-is, remove the EUR-only assumption, compare minor units, call `link_payment_intent`.
- `src/app/(api)/(stripe)/webhook+api.ts`: call `process_stripe_event` with the event fields. Return non-2xx on `RETRYABLE`.
- `src/app/(api)/(stripe)/pay+api.ts`: use the same currency helper if it sends amounts.
- `src/lib/ride-service.ts`: stop direct ride inserts. Use `confirm_cash_booking` for cash and the webhook path for card. Store `fare_price` in minor units.
- `src/app/(api)/booking+api.ts`: accept a payment method, compute the amount on the server, set currency `XAF`, and insert the booking with its method.
- `src/app/(api)/booking/recover+api.ts`: route state writes through the functions. Not yet read in full.
- A new backend route for driver cash collection. The authenticated driver must match the booking's driver.
- A new backend route for rider cash response (acknowledge or dispute).
- A new backend route for refund requests (rider) and decisions (support or admin), using the role checks.
- `src/lib/payment-verification.ts` and `lib/web-booking-recovery.ts`: not read in full. Must be read before the list is final.

## Open decisions for the product owner

1. Who may confirm cash collection beyond the assigned driver? The package follows the decision: assigned driver only.
2. Automatic refund rules beyond driver cancellation before pickup. Only that one rule is coded.
3. Settlement schedule for driver payouts. Only the settlement status is modelled.
4. The Stripe capture mode. The package supports both authorization and automatic capture. Confirm which one the live account uses.

## Residual risks

1. Nothing has been run. The SQL and tests are unverified against the real schema.
2. The database trusts the backend to authenticate the caller. A route that skips the check bypasses the driver and role rules.
3. The existing `rides` table may have NOT NULL columns the inserts do not provide. Verification is step 2 of the deployment.
4. Enabling RLS on `rides`, `booking_attempts` and `webhook_events` must not break any client that reads them directly. Confirm no anon or authenticated client uses them.
5. Legacy rides remain `legacy_unknown`. Support staff will need a manual process to reconcile them.
6. The reserved MTN and Orange rows are inactive and have no provider behaviour yet.
