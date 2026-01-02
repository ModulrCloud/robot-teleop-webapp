# Staged GSI Deployment Instructions

## Problem
DynamoDB only allows **one GSI operation per table update**. The merge is trying to modify multiple GSIs, causing deployment failure.

## Solution: Two-Stage Deployment

### Stage 1: Remove Old GSIs (Current State)
**Goal:** Deploy with `timestampIndexV2` temporarily commented out. This allows CloudFormation to:
- Remove any old `timestampIndex` GSI (if it exists)
- Keep `adminUserIdIndex` and `targetUserIdIndex` unchanged
- No new GSI creation = no conflict

**Current Status:** ✅ **READY FOR STAGE 1**
- `timestampIndexV2` GSI definition is commented out
- IAM permissions for `timestampIndexV2` are commented out
- Lambda functions have fallback to Scan, so they'll still work

**Action Required:**
1. Commit and push this change
2. Deploy to sandbox
3. Wait for deployment to complete (check CloudFormation stack events)
4. Verify in AWS Console that old `timestampIndex` is gone (if it existed)

### Stage 2: Add timestampIndexV2 (After Stage 1 Completes)
**Goal:** Uncomment `timestampIndexV2` and deploy. This will create the new GSI.

**After Stage 1 Completes:**
1. Uncomment the `timestampIndexV2` GSI definition in `amplify/backend.ts` (lines 731-735)
2. Uncomment the IAM permissions in `amplify/backend.ts` (lines 816 and 984)
3. Commit and push
4. Deploy to sandbox
5. Wait for GSI creation to complete (5-15 minutes)

## Files Modified for Stage 1
- `amplify/backend.ts`:
  - Line ~731-735: GSI definition commented out
  - Line ~816: IAM permission commented out  
  - Line ~984: IAM permission commented out

## Notes
- Lambda functions (`list-audit-logs`, `cleanup-audit-logs`) have fallback logic to use Scan if GSI doesn't exist
- This means Stage 1 deployment won't break functionality
- Stage 2 will restore full performance (Query instead of Scan)

## Verification
After each stage, verify in AWS Console:
- DynamoDB → Tables → AdminAuditTable → Indexes tab
- Check which GSIs exist
- Stage 1 should show: `adminUserIdIndex`, `targetUserIdIndex` (and no `timestampIndexV2`)
- Stage 2 should show: all 3 GSIs including `timestampIndexV2`

