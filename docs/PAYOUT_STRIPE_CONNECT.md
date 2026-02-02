# Partner payouts via Stripe Connect (Express)

Use **Stripe Connect** with **Express** accounts so partners can get paid via Stripe. Stripe hosts onboarding and handles bank details; you only store the connected account ID and optionally onboarding state.

## What you store on the backend

On the **Partner** model we store:

| Field | Purpose |
|-------|--------|
| `stripeConnectAccountId` | Stripe connected account ID (e.g. `acct_xxx`). **Required** to create Transfers/Payouts to this partner. |
| `stripeConnectOnboardingComplete` | Optional. Set to `true` when `details_submitted` and `charges_enabled` (or payouts) are true — use this to show “Complete setup” vs “You’re all set” in the UI. |

You do **not** store bank account numbers, routing numbers, or KYC details; Stripe holds those.

## High-level flow

1. **Partner chooses Fiat (Stripe)**  
   They set “Payout preferences” → “Fiat (Stripe)” in your app (already implemented).

2. **“Set up Stripe payouts”**  
   When they’re ready (e.g. from Dashboard or Payout preferences), they click a button that calls your backend.

3. **Backend: create Express account (if needed)**  
   - If `Partner.stripeConnectAccountId` is empty, call [Stripe Create Account](https://docs.stripe.com/api/accounts/create) with `type: 'express'`.  
   - Store the returned `id` (e.g. `acct_xxx`) in `Partner.stripeConnectAccountId`.  
   - You can prefill `email`, `country`, `business_type`, etc. from your Partner/User data.

4. **Backend: create Account Link**  
   Call [Create Account Link](https://docs.stripe.com/api/account_links/create) with:
   - `account`: the connected account ID  
   - `refresh_url`: your URL when the link expires (e.g. `/dashboard?stripe=refresh`)  
   - `return_url`: your URL when onboarding finishes (e.g. `/dashboard?stripe=return`)  
   - `type`: `account_onboarding`  

   Return the `url` from the API response to the frontend.

5. **Frontend: redirect to Stripe**  
   Send the partner to that `url`. They complete Stripe’s hosted onboarding (identity, bank account, etc.).

6. **Partner returns to your app**  
   - Stripe redirects to your `return_url` or `refresh_url`.  
   - **return_url**: Onboarding was completed (or abandoned). Call [Retrieve Account](https://docs.stripe.com/api/accounts/retrieve) and check `details_submitted` and `charges_enabled`; update `stripeConnectOnboardingComplete` if fully onboarded.  
   - **refresh_url**: Link expired or already used. Create a **new** Account Link (same parameters) and redirect the partner to the new URL (do not reuse the old link).

7. **When you pay them (e.g. monthly)**  
   In your existing payout/process-payout logic:
   - Use [Stripe Transfers](https://docs.stripe.com/connect/separate-charges-and-transfers) to send money from your platform balance to `Partner.stripeConnectAccountId`.  
   - Or use [Create Payout](https://docs.stripe.com/api/payouts/create) on the connected account if you hold balance on their account.  
   Your existing Stripe secret key and Connect account ID are enough; no custom bank integration.

## What to build (minimal)

- **Lambda (or API route): “Create Stripe Connect onboarding link”**  
  - Input: authenticated partner (from Cognito).  
  - Load Partner by cognitoUsername; if no `stripeConnectAccountId`, create Express account via Stripe API and save it.  
  - Create Account Link for that account; return `{ url }` to the client.  
  - Frontend redirects to `url`.

- **Frontend: “Set up Stripe payouts” button**  
  - Shown when `preferredPayoutType === 'fiat'` and (optionally) when `!stripeConnectOnboardingComplete`.  
  - Calls the Lambda above, then `window.location = result.url`.

- **Return/refresh handling**  
  - On `return_url` / `refresh_url` (e.g. `/dashboard?stripe=return`), call a backend that retrieves the account, updates `stripeConnectOnboardingComplete`, and (for refresh) returns a new Account Link URL and redirects again.

- **Process payout (existing or new)**  
  - When running payouts (e.g. monthly), for each partner with `preferredPayoutType === 'fiat'` and `stripeConnectAccountId`, use Stripe Transfers (or Payouts) to send their balance to `stripeConnectAccountId`.

## Stripe setup

- **Connect** is enabled per Stripe account (Dashboard → Connect → Get started).  
- Use the **same** Stripe secret key you already use for checkout; Connect API calls (accounts, account_links, transfers) use that key.  
- Configure [Connect settings](https://dashboard.stripe.com/account/applications/settings) (branding, supported countries) and complete the platform profile.

## References

- [Stripe Connect Express accounts](https://docs.stripe.com/connect/express-accounts)  
- [Account Links (onboarding)](https://docs.stripe.com/api/account_links/create)  
- [Transfers to connected accounts](https://docs.stripe.com/connect/separate-charges-and-transfers)
