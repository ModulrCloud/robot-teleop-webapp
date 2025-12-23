# Robot Pricing and Credit Deduction System

## Overview
This document outlines the implementation of robot pricing, credit deduction, partner payouts, and the foundation for an admin panel.

## What's Been Implemented

### 1. Robot Pricing System ✅
- **Added `hourlyRateCredits` field to Robot model** (default: 100 credits/hour)
- **Updated CreateRobotListing page** - Partners can now set hourly rate when creating robots
- **Updated EditRobot page** - Partners can edit hourly rate for existing robots
- **Updated Lambda functions** (`setRobotLambda`, `updateRobotLambda`) to handle hourly rate
- **Added `robotIdIndex`** to Robot model for efficient lookups by robotId string

### 2. Credit Deduction System ✅
- **Created `processSessionPaymentLambda`** - Handles credit deduction when sessions end
  - Calculates cost based on session duration and robot's hourly rate
  - Applies platform markup (configurable, defaults to 20%)
  - Deducts credits from user account
  - Creates credit transaction record
  - Creates partner payout record
  - Updates session with cost information

### 3. Platform Markup System ✅
- **Created `PlatformSettings` model** - Stores platform configuration
  - `settingKey`: 'platformMarkupPercent' (or other settings)
  - `settingValue`: The markup percentage (e.g., "20")
  - Accessible to all authenticated users (for cost calculations)
  - Only ADMINS can create/update
- **Default markup**: 30% if not configured (matching Steam's model)
- **Markup calculation**: Applied on top of partner's hourly rate

### 4. Partner Payout Tracking ✅
- **Created `PartnerPayout` model** - Tracks partner earnings
  - `partnerId`: Partner's Cognito user ID
  - `sessionId`: Reference to the session
  - `robotId`, `robotName`: Robot information
  - `creditsEarned`: Partner's earnings (after markup)
  - `platformFee`: Platform markup deducted
  - `totalCreditsCharged`: Total charged to user
  - `durationSeconds`: Session duration
  - `status`: 'pending', 'paid', 'cancelled'
  - Partners can view their own payouts
  - ADMINS can view all payouts and manage status

### 5. Session Cost Tracking ✅
- **Updated `Session` model** with cost fields:
  - `creditsCharged`: Total credits charged to user
  - `partnerEarnings`: Credits earned by partner (after markup)
  - `platformFee`: Platform markup in credits
  - `hourlyRateCredits`: Robot's hourly rate at time of session (snapshot)

## How It Works

### Credit Deduction Flow
1. **Session Ends** → `processSessionPaymentLambda` is called
2. **Calculate Costs**:
   - Duration in hours = `durationSeconds / 3600`
   - Base cost = `hourlyRateCredits * durationHours`
   - Platform fee = `baseCost * (markupPercent / 100)`
   - Total charged = `baseCost + platformFee`
   - Partner earnings = `baseCost` (before markup)
3. **Deduct Credits**:
   - Check user has sufficient credits
   - Deduct total credits from user account
   - Create credit transaction record (negative amount)
4. **Record Payout**:
   - Create PartnerPayout record with 'pending' status
5. **Update Session**:
   - Store all cost information in Session record

### Example Calculation
- Robot hourly rate: 100 credits/hour
- Session duration: 30 minutes (0.5 hours)
- Platform markup: 30%

**Calculation:**
- Base cost: 100 × 0.5 = 50 credits
- Platform fee: 50 × 0.30 = 15 credits
- **Total charged to user: 65 credits**
- **Partner earnings: 50 credits**

## What Still Needs to Be Done

### 1. Admin Page (Domain-Based Access) ⏳
- Create `/admin` page that only shows for `@modulr.cloud` email addresses
- Features to include:
  - View all partner payouts
  - Process payouts (change status from 'pending' to 'paid')
  - View platform settings
  - Update platform markup percentage
  - View system statistics
  - Manage credit tiers
  - View admin audit logs

### 2. Session End Integration ⏳
- **Integrate `processSessionPaymentLambda` into session end flow**
  - Option 1: Call from `endSession` function in signaling handler
  - Option 2: Call from frontend when user ends session
  - Option 3: Use DynamoDB Streams to trigger on Session updates
- **Handle edge cases**:
  - What if user doesn't have enough credits? (Block session start or allow with warning?)
  - What if payment processing fails? (Retry logic, error handling)
  - What about partial sessions? (Disconnections, errors)

### 3. Partner Dashboard (Future) 📋
- Create partner-facing page to view:
  - Total earnings (sum of all payouts)
  - Pending payouts
  - Paid payouts
  - Earnings by robot
  - Earnings over time (charts/graphs)
  - Payout history

### 4. Credit Balance Checks (Future) 📋
- **Before session starts**: Check if user has sufficient credits
- **During session**: Monitor balance (for auto top-up)
- **Low balance warning**: Show banner when credits < threshold

### 5. Auto Top-Up Integration (Future) 📋
- When credits fall below threshold during session:
  - Trigger auto top-up purchase
  - Use saved payment method (Stripe Setup Intent)
  - Add credits immediately
  - Continue session

## Database Schema Changes

### New Models
1. **PlatformSettings** - Platform configuration
2. **PartnerPayout** - Partner earnings tracking

### Updated Models
1. **Robot** - Added `hourlyRateCredits` field
2. **Session** - Added cost tracking fields (`creditsCharged`, `partnerEarnings`, `platformFee`, `hourlyRateCredits`)

### New Indexes
1. **Robot.robotIdIndex** - For lookups by robotId string
2. **PlatformSettings.settingKeyIndex** - For quick setting lookups
3. **PartnerPayout.partnerIdIndex** - For partner earnings queries
4. **PartnerPayout.statusIndex** - For filtering by payout status

## Security Considerations

### Credit Deduction
- Only session owner or admin can process payment
- Verifies user has sufficient credits before deduction
- All transactions are logged in CreditTransaction table

### Partner Payouts
- Partners can only view their own payouts (owner-based authorization)
- ADMINS can view all payouts and manage status
- Payout status prevents double-processing

### Platform Settings
- All users can read (needed for cost calculations)
- Only ADMINS can modify

## Testing Checklist

- [ ] Create robot with hourly rate
- [ ] Edit robot hourly rate
- [ ] Start and end a session
- [ ] Verify credits are deducted correctly
- [ ] Verify partner payout is created
- [ ] Verify session cost fields are populated
- [ ] Test with insufficient credits (should fail gracefully)
- [ ] Test platform markup calculation
- [ ] View partner payouts (as partner)
- [ ] View all payouts (as admin)
- [ ] Update platform markup (as admin)

## Next Steps

1. **Implement Admin Page** - Domain-based access for @modulr.cloud users
2. **Integrate Credit Deduction** - Call `processSessionPaymentLambda` when sessions end
3. **Add Error Handling** - Handle insufficient credits, payment failures, etc.
4. **Create Partner Dashboard** - View earnings and payout history
5. **Add Credit Balance Checks** - Before/during sessions

## Notes

- **Credits vs. Currency**: The system uses credits as the internal currency. Credits are purchased with real money (via Stripe), but all pricing and deductions are in credits.
- **Markup**: The platform markup is applied on top of the partner's rate. Partners set their rate, and Modulr adds the markup for clients.
- **Payout Status**: Payouts start as 'pending' and must be manually processed by admins (changed to 'paid'). This allows for manual review and actual payment processing outside the system.
- **Session Cost Snapshot**: The robot's hourly rate is stored in the Session record at payment time, so historical sessions reflect the rate at the time of the session (even if the rate changes later).

