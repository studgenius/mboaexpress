# Phase 2N.4.3 v5 payment architecture review package

Status: REVIEW DRAFT. Nothing has been executed. No SQL, migrations, database changes, Stripe operations, or application edits have been made. Awaiting explicit approval.

This revision supersedes the v4 README. The SQL files in this folder are still the v4 drafts and must be revised to match the decisions below before any run.

## Product decisions (agreed)

1. Support Stripe card payments and cash.
2. A ride may exist without a PaymentIntent only when its payment method explicitly permits it. Today that is cash only.
3. Stripe card bookings require a valid PaymentIntent that matches the booking's amount, currency, and attempt.
4. The payment design must accept MTN Mobile Money and Orange Money later without another major schema migration.
5. Ride status, payment status, and driver settlement status are independent columns with independent state machines.
6. Webhook idempotency, payment reconciliation, and transactional integrity are preserved.
7. All monetary values are integer XAF amounts, with XAF minor units (exponent 0, so one franc is the smallest unit).

## Verified facts that change the plan

- The live Stripe create route sets `CURRENCY = "eur"` and sends `Math.round(amount * 100)` to Stripe. The agreed convention is XAF with no subunit, so the amount sent to Stripe must be whole francs, not multiplied by 100. Stripe treats XAF as a zero-decimal currency. This is a change to live payment code, not only to the database.
- `booking_attempts.expected_amount` is `INTEGER` with a default currency of `'eur'`. The v4 SQL carries the same default. The v5 migration must change the currency check to `'XAF'` (stored uppercase, compared case-insensitively) and document that the integer is francs.
- `ride-service.ts` stores `fare_price` as the Stripe amount in cents. Under the v5 convention it stores francs. Existing rows (2, both `paid`, both without a PaymentIntent, both created before the Stripe flow) need a documented interpretation. They should be treated as legacy with unknown unit and left untouched.
- `src/lib/utils.ts` already has `formatXaf` for display, so the UI convention is already XAF.
- Two existing rides have no PaymentIntent and no attempt link. Under the v5 rules they are legacy records and are not reclassified.

## Payment method model

- `payment_methods` is a reference table with a stable code, a display name, a flag `requires_payment_intent`, and a flag `allows_no_intent`.
- Seed rows: `card_stripe` (requires intent, no-intent not allowed), `cash` (no intent, no-intent allowed), and reserved rows `mtn_momo` and `orange_money` (inactive, provider not yet integrated).
- A ride stores `payment_method_code` as a foreign key. A CHECK enforces that a ride without a PaymentIntent references a method with `allows_no_intent = true`. A ride with a PaymentIntent must reference a method with `requires_payment_intent = true`.
- Adding MTN or Orange later means inserting a provider row and attempt rows with a provider reference, not new tables.
- Provider-specific references (PaymentIntent id, MoMo transaction id, Orange transaction id) are stored in a generic `payment_provider_refs` table keyed by `(provider, external_id)` with a unique constraint. This avoids a per-provider column.

## Entities

- `booking_attempts`: parent booking. Currency is `XAF`. `expected_amount` is francs.
- `payment_attempts`: one row per attempt to pay. Holds `payment_method_code`, `status`, `expected_amount` (francs), and `currency = 'XAF'`. Unique external reference via `payment_provider_refs`.
- `payment_attempt_transitions`: append-only log of attempt state changes.
- `rides`: `ride_status`, `payment_status`, `settlement_status` are three independent columns. Ride status is the trip lifecycle. Payment status tracks money collected. Settlement status tracks payout to the driver. None of them drives the others directly. A database trigger refuses a ride status of `completed` unless payment status is `paid` or `cash_collected`. That is the only cross-column rule.
- `webhook_events`: `(provider, external_event_id)` unique. Stores payload hash and processing result.
- `settlements`: optional, reserved for settlement status. Not created in v5 unless approved.

## Amount rules

- All amounts are `INTEGER`, `CHECK (amount > 0)`, in XAF francs.
- Application code converts nothing. Stripe receives `amount` in francs with currency `xaf`. The Stripe create route must stop multiplying by 100.
- Comparisons are exact integer equality between the booking, the attempt, and the provider's reported amount. A mismatch moves the attempt to `mismatch_held`.

## Ride payment-state matrix

| Payment method | Ride created when | payment_status on create | Notes |
|---|---|---|---|
| `card_stripe` | Attempt reaches `succeeded` | `paid` | Requires PaymentIntent and matching amount |
| `cash` | Booking confirmed by driver or rider | `cash_pending` | No PaymentIntent. Cash collected by driver later |
| `mtn_momo`, `orange_money` | Reserved | Not allowed in v5 | Requires an approved provider integration |

Payment status values: `unpaid`, `cash_pending`, `cash_collected`, `paid`, `failed`, `refunded`, `disputed`, `held_for_review`.

Settlement status values: `not_applicable`, `pending`, `settled`, `held`.

Ride status values: unchanged from the existing app.

## Attempt state matrix (card)

| From | Event | To | Notes |
|---|---|---|---|
| `pending` | open attempt | `pending` | Idempotent by booking |
| `pending` | link PaymentIntent (amount and currency match) | `payment_intent_created` | |
| `payment_intent_created` | `payment_intent.succeeded` (match) | `succeeded` | Creates exactly one ride |
| `payment_intent_created` | `payment_intent.payment_failed` | `failed` | Stripe may retry on same intent; see retry rules |
| `payment_intent_created` | `payment_intent.canceled` | `canceled` | |
| `succeeded` | `charge.refunded` | `refunded` | Sets ride `payment_status = refunded` |
| `succeeded` | `charge.dispute.created` | `disputed` | Sets ride `payment_status = disputed` |
| any open | success for another attempt on same booking | `held_for_review` | Never silently applied |
| any | amount or currency mismatch | `held_for_review` | |
| `failed`, `canceled` | late success | `held_for_review` | Manual refund path |

## Cash state matrix

| From | Event | To |
|---|---|---|
| none | booking confirmed with method `cash` | ride created, `payment_status = cash_pending` |
| `cash_pending` | driver confirms collection | `cash_collected` |
| `cash_pending` | ride cancelled | `unpaid` (no money moved) |

Cash has no PaymentIntent and no webhook. Its transitions are written by authorised app actions, not by providers, and go through the same transition log.

## Webhook and retry rules

- Each event inserts into `webhook_events` with `ON CONFLICT DO NOTHING` on `(provider, external_event_id)`. A repeat returns `duplicate` and does nothing else.
- An unknown PaymentIntent or charge raises a retryable error. The dedupe row rolls back and the provider redelivers. The HTTP response is non-2xx.
- A non-retryable mismatch is recorded as `held_for_review` and acknowledged 2xx.
- Stale events are ignored by comparing provider event time against the attempt's last applied event time.

## Migration design (v5, to be written)

1. Create `payment_methods` and seed it.
2. Add `payment_method_code` to `booking_attempts` and `rides`, with the cross-column CHECK described above.
3. Create `payment_provider_refs` with a unique key. Backfill the two legacy rides as `cash` only if the product owner confirms they were cash. Otherwise leave method NULL and mark them `legacy`.
4. Change currency checks to `XAF`. Do not rewrite existing `expected_amount` values. Document that pre-v5 Stripe amounts were stored as cents where they were, and mark those attempts `legacy_eur_cents`.
5. Add independent `payment_status` and `settlement_status` columns to rides.
6. Rebuild the attempt state functions to match the matrices above.
7. Enable RLS on all new tables with deny-by-default policies. Grant only to the roles the app uses.

Because v4 has not run, v5 replaces the v4 forward migration instead of layering on it.

## Rollback strategy

- Before the forward migration, take a Neon branch snapshot of production.
- The reversal archives all new tables and the changed columns with per-row md5 hashes and a manifest.
- Rollback is refused if any attempt is `held_for_review`, `disputed`, or `refunded`, or if any ride is `cash_collected` without an archived copy.
- Restoring the pre-v5 shape drops only v5 objects. It never drops `rides` rows or `booking_attempts` rows.
- Post-rollback check compares restored row hashes with the archive.

## Deployment sequence (proposed)

1. Approve the v5 design and the cents-to-francs conversion of the Stripe create route.
2. Rewrite the v5 SQL and tests in this folder. Review again.
3. Run the SQL and both test suites on a disposable Neon branch. Run the two-session test with `TEST_DATABASE_URL`.
4. Snapshot production.
5. Apply the migration in a maintenance window.
6. Deploy the application changes in the same release: booking creation (payment method), Stripe create (francs, no x100), webhook (state functions), ride creation (method and links), cash confirmation action, recovery route, and display of payment status.
7. Watch webhook responses and held-for-review counts.
8. Rollback path as described above.

## Application files that must change in the same release

- `src/app/(api)/(stripe)/create+api.ts`: send francs, not cents. Currency `xaf`. Compare amount in francs.
- `src/app/(api)/(stripe)/webhook+api.ts`: route through state functions. Return non-2xx for retryable errors.
- `src/app/(api)/(stripe)/pay+api.ts`: check amount and currency with the same rule. Likely a small change.
- `src/lib/ride-service.ts`: create rides with a payment method and links. Store `fare_price` in francs.
- `src/app/(api)/booking+api.ts`: accept a payment method. Set currency `XAF`.
- `src/app/(api)/booking/recover+api.ts`: route writes through state functions.
- A new cash-confirmation action (driver side). Not yet designed in the UI.
- `src/lib/payment-verification.ts` and `lib/web-booking-recovery.ts`: not read in full. Must be checked before the list is final.
- `src/lib/utils.ts`: `formatXaf` already exists. No change expected.

## Assumptions still to confirm

1. The product owner confirms that the two existing rides are not cash. If unknown, they are marked `legacy`.
2. Stripe account settlement supports XAF for the chosen merchant.
3. `drivers.id` is a primary key and drivers have a `ride_status`-independent settlement path.
4. Driver cash confirmation is performed in the app by the driver, with no separate approval step.

## Open product decisions

1. Who may confirm cash collection: driver only, or also the rider?
2. Settlement schedule for drivers (per ride, daily, or weekly). Not modelled in v5 beyond a status column.
3. Refund authority for `held_for_review` attempts.

## Residual risks

1. Stripe currently receives cents. Until the create route is changed, a card payment could be charged 100 times the intended XAF amount. The change must ship with the migration, and no card payment should run between the two.
2. Nothing has been run against any database.
3. The two existing rides have an unknown amount unit.
4. Cash collection has no provider record, so it relies on the driver's action and an audit log only.
5. RLS is off on the existing tables. New tables must enable it from the start.
