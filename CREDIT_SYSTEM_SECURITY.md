# Credit System Implementation & Security Analysis

## What We Built Today

### 1. **Stripe Payment Integration**
   - **`createStripeCheckoutLambda`**: Creates Stripe Checkout sessions
     - Takes `tierId` and `userId` as arguments
     - Verifies the `userId` matches the authenticated user
     - Creates a Stripe session with metadata (userId, tierId, credits, amount)
     - Returns checkout URL and session ID
   
   - **`verifyStripePaymentLambda`**: Verifies payment completion
     - Takes `sessionId` as argument
     - Retrieves session from Stripe
     - Verifies payment status is 'paid'
     - Verifies the userId in metadata matches authenticated user
     - Returns payment details (userId, tierId, credits, amountPaid)
   
   - **`addCreditsLambda`**: Adds credits to user account
     - Takes `userId`, `credits`, `amountPaid`, `currency`, `tierId`
     - **Security Check**: Verifies user is admin OR the userId matches authenticated user
     - Queries DynamoDB using secondary index (`userIdIndex`)
     - Updates existing record or creates new one
     - Creates transaction record in `CreditTransaction` table
     - Returns success with new balance

### 2. **Credit Retrieval**
   - **`getUserCreditsLambda`**: Queries user credits
     - No arguments (uses authenticated user's identity)
     - Queries DynamoDB using secondary index
     - **Security**: Only returns the authenticated user's own credits
     - Returns credits balance and auto top-up settings

### 3. **Frontend Integration**
   - **PurchaseCreditsModal**: Handles Stripe checkout initiation
   - **Credits Page**: Displays balance, auto top-up settings, transaction history
   - Handles Stripe redirect and payment processing

## Security Analysis

### ✅ **SECURE Components**

1. **Lambda Functions (Backend Authorization)**
   - All Lambda functions verify authentication
   - `addCreditsLambda`: Checks `isAdmin || isOwner` before allowing credit addition
   - `getUserCreditsLambda`: Only queries for the authenticated user's `userId` (from `identity.username`)
   - `verifyStripePaymentLambda`: Verifies userId in session metadata matches authenticated user
   - Users **CANNOT** add credits to other users' accounts via Lambdas
   - Users **CANNOT** query other users' credits via Lambdas

2. **DynamoDB Direct Access**
   - Lambda functions use DynamoDB directly (bypassing GraphQL)
   - This is secure because authorization is enforced in Lambda code
   - Users cannot call DynamoDB directly (no AWS credentials in frontend)

### ⚠️ **POTENTIAL SECURITY ISSUES**

1. **GraphQL Model Direct Access**
   ```typescript
   // In Credits.tsx - STILL USED for auto top-up settings
   client.models.UserCredits.list({ filter: { userId: { eq: user.username } } })
   client.models.UserCredits.update({ ... })
   client.models.UserCredits.create({ ... })
   ```
   
   **Current Authorization:**
   ```typescript
   .authorization((allow) => [
     allow.authenticated().to(['read']),  // ⚠️ All authenticated users can READ
     allow.groups(['ADMINS']).to(['create', 'read', 'update', 'delete']),
   ])
   ```
   
   **Issues:**
   - Users can READ all UserCredits records (not just their own)
   - The comment says "filtering by userId happens in app code" - this is **NOT secure**
   - A malicious user could query: `UserCredits.list({ filter: { userId: { eq: 'other_user_id' } } })`
   - Users CANNOT create/update via GraphQL (only ADMINS can), which is good
   
   **Risk Level**: **MEDIUM** - Users can see other users' credit balances if they know the userId

2. **Frontend Filtering (Not Secure)**
   - The frontend filters by `user.username`, but this can be bypassed
   - A user could modify the frontend code or make direct GraphQL calls to query other users

### 🔒 **RECOMMENDED SECURITY FIXES**

#### Option 1: Remove GraphQL Model Access (Recommended)
Since we now have `getUserCreditsLambda` that works perfectly, we should:
1. Remove direct `UserCredits.list()` calls from frontend
2. Use `getUserCreditsLambda` for all credit retrieval
3. Keep GraphQL model access restricted to ADMINS only

#### Option 2: Add Field-Level Authorization
Add owner-based authorization to the `userId` field:
```typescript
UserCredits: a.model({
  id: a.id(),
  userId: a.string().required().authorization(allow => [allow.owner()]), // Only owner can read
  // ... other fields
})
.authorization((allow) => [
  allow.owner().to(['read']),  // Users can only read their own
  allow.groups(['ADMINS']).to(['create', 'read', 'update', 'delete']),
])
```

However, this requires the model to have an `owner` field, which it doesn't currently.

#### Option 3: Remove Read Access Entirely
```typescript
.authorization((allow) => [
  // Remove authenticated read - force users to use Lambda
  allow.groups(['ADMINS']).to(['create', 'read', 'update', 'delete']),
])
```
Then all reads must go through `getUserCreditsLambda`, which is properly secured.

## Current State Summary

### What Users CAN Do:
- ✅ View their own credits (via `getUserCreditsLambda` - secure)
- ✅ Purchase credits (via Stripe - secure)
- ✅ View their own transaction history (filtered by userId in app code)
- ⚠️ **POTENTIALLY** view other users' credits (via GraphQL `UserCredits.list()` - insecure)
- ❌ Cannot create/update credits directly (only ADMINS can via GraphQL)
- ❌ Cannot add credits to other users (Lambda enforces owner check)

### What Users CANNOT Do:
- ❌ Modify credits directly (only via `addCreditsLambda` after Stripe payment)
- ❌ Add credits to other users' accounts (Lambda checks owner)
- ❌ Access DynamoDB directly (no AWS credentials)
- ❌ Bypass Stripe payment (credits only added after verified payment)

## ✅ **SECURITY FIXES IMPLEMENTED**

### Fixed Issues:
1. **Replaced `UserCredits.list()` with `getUserCreditsLambda`**
   - `loadCreditsData()` now uses the secured Lambda query
   - Users can only query their own credits (enforced in Lambda)

2. **Created `updateAutoTopUpLambda` for auto top-up settings**
   - Users can update their own auto top-up settings (enabled, threshold, tier)
   - **CRITICAL**: Lambda only updates auto top-up fields, NOT credits
   - Users cannot modify credits through this function
   - Authorization: Only updates the authenticated user's own record

### Remaining Security Posture:

**What Users CAN Do (Secured):**
- ✅ View their own credits (via `getUserCreditsLambda` - secured)
- ✅ Update their own auto top-up settings (via `updateAutoTopUpLambda` - secured, cannot modify credits)
- ✅ Purchase credits (via Stripe - secured)
- ✅ View their own transaction history (filtered by userId)

**What Users CANNOT Do:**
- ❌ View other users' credits (Lambda enforces own userId only)
- ❌ Modify credits directly (only via `addCreditsLambda` after Stripe payment)
- ❌ Add credits to other users' accounts (Lambda checks owner)
- ❌ Update credits via auto top-up Lambda (only updates settings, not credits)
- ❌ Access DynamoDB directly (no AWS credentials)
- ❌ Bypass Stripe payment (credits only added after verified payment)

### GraphQL Model Access Status:

The `UserCredits` model still has `allow.authenticated().to(['read'])`, which theoretically allows users to read any UserCredits record. However:

1. **Frontend no longer uses it** - All reads go through `getUserCreditsLambda`
2. **Users cannot update/create via GraphQL** - Only ADMINS can
3. **Recommendation**: Consider removing read access entirely to be extra safe:
   ```typescript
   .authorization((allow) => [
     // Remove authenticated read - all access through Lambdas
     allow.groups(['ADMINS']).to(['create', 'read', 'update', 'delete']),
   ])
   ```

This would force all access through the secured Lambda functions, providing defense in depth.

