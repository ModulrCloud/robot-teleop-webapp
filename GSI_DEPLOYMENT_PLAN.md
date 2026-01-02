# GSI Deployment Plan - AdminAuditTable

## Problem
DynamoDB limitation: **Only one GSI can be created or deleted per table update**. The merge is trying to modify multiple GSIs on `AdminAuditTable` simultaneously, causing deployment failure.

## Current GSI Configuration (in code)
AdminAuditTable has 3 GSIs defined:
1. `adminUserIdIndex` - partition key: `adminUserId`
2. `targetUserIdIndex` - partition key: `targetUserId`  
3. `timestampIndexV2` - partition key: `logType`, sort key: `timestamp`

## Staged Deployment Strategy

### Option 1: Check Current State First (Recommended)
**Before making changes, verify what GSIs currently exist in the deployed environment:**

1. **Check AWS Console:**
   - Go to DynamoDB → Tables → AdminAuditTable → Indexes tab
   - Note which GSIs exist:
     - Does `timestampIndex` (old) exist?
     - Does `timestampIndexV2` exist?
     - Do `adminUserIdIndex` and `targetUserIdIndex` exist?

2. **Based on what exists, choose the appropriate stage below**

### Option 2: Staged Deployment (If old timestampIndex exists)

#### Stage 1: Remove Old GSI (if it exists)
**Goal:** Remove any old `timestampIndex` GSI before adding new ones

**Changes needed:**
- Ensure code doesn't reference old `timestampIndex` for AdminAuditTable
- Deploy this first
- Wait for deployment to complete

**After Stage 1:**
- Old `timestampIndex` should be deleted
- Other GSIs remain unchanged

#### Stage 2: Add New GSI
**Goal:** Add `timestampIndexV2` GSI

**Changes needed:**
- Code already has `timestampIndexV2` defined
- Deploy this
- Wait for GSI creation to complete (can take several minutes)

**After Stage 2:**
- `timestampIndexV2` should be created
- All 3 GSIs should now exist

### Option 3: If All GSIs Already Exist
If all 3 GSIs already exist in the deployed environment, the issue might be:
- CloudFormation detecting a change that doesn't actually need to happen
- A mismatch in GSI definition (e.g., sort key differences)

**Solution:**
- Ensure the code exactly matches what's deployed
- No GSI changes needed, just code updates

## Recommended Approach

1. **First, check AWS Console** to see current GSI state
2. **If old `timestampIndex` exists:**
   - Create a temporary branch that removes any old GSI references
   - Deploy that first (Stage 1)
   - Then deploy the full changes (Stage 2)

3. **If all GSIs already exist:**
   - The issue might be a CloudFormation drift
   - Try deploying as-is, or check for any GSI definition mismatches

## Files to Check
- `amplify/backend.ts` lines 720-735 (GSI definitions)
- `amplify/data/resource.ts` lines 202-207 (Schema GSI definitions)
- Ensure no references to old `timestampIndex` for AdminAuditTable

## Notes
- GSI creation/deletion can take 5-15 minutes
- Wait for each stage to fully complete before proceeding
- Monitor CloudFormation stack events for GSI operations

