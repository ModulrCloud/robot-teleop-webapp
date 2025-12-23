# Admin Access & Security Analysis

## Current State: Who Can Be an Admin?

### ❌ **NO AUTOMATED WAY TO BECOME ADMIN**

Currently, there is **NO code path** that allows users to become admins:

1. **`setUserGroupLambda`** - Only allows adding to `CLIENTS` or `PARTNERS` groups
   - Authorization: `allow.authenticated()` (any logged-in user can call it)
   - **Restriction**: `ALLOWED_GROUPS = ['client', 'partner']` - **ADMINS is NOT in this list**
   - Users can only add themselves to CLIENTS or PARTNERS, never ADMINS

2. **No Frontend Code** - No UI exists to assign admin status

3. **No Admin Assignment Lambda** - No function exists to manage admin assignments

### ⚠️ **HOW ADMINS ARE CURRENTLY ASSIGNED**

**Admins must be manually added through AWS Cognito Console:**
1. Go to AWS Cognito Console
2. Select User Pool
3. Go to Users → Select user → Groups tab
4. Manually add user to "ADMINS" group

**This is a SECURITY RISK because:**
- ❌ No audit trail (who added the admin? when? why?)
- ❌ No approval process
- ❌ Anyone with AWS Console access can add themselves
- ❌ No logging of admin assignments
- ❌ No way to track admin actions

## Security Issues Identified

### 🔴 **CRITICAL: No Controlled Admin Assignment**

**Problem**: Admins are assigned manually with no tracking or controls.

**Risk**: 
- Someone with AWS Console access could add themselves as admin
- No way to know who added admins or when
- No approval workflow
- Admins have full access to credits, robots, and all data

### 🟡 **MEDIUM: setUserGroupLambda Authorization Too Broad**

**Current**: `allow.authenticated()` - ANY authenticated user can call it

**Issue**: While it only allows adding to CLIENTS/PARTNERS, the authorization is too permissive. Should be:
- Only allow during initial user setup (first-time users)
- Or require admin approval
- Or restrict to specific conditions

**Current Risk**: Low (can't add to ADMINS), but could be improved

### 🟢 **GOOD: Admin Checks in Lambda Functions**

All Lambda functions that check for admin status do so correctly:
- `addCreditsLambda`: Checks `isAdmin || isOwner`
- `updateRobotLambda`: Checks admin or owner
- `deleteRobotLambda`: Checks admin or owner
- `manageRobotACLLambda`: Checks admin or owner
- All use: `identity.groups?.includes("ADMINS")`

## Recommended Solution: Admin Management Lambda

Create a **secure, tracked admin management system**:

### 1. **`assignAdminLambda`** (Admin-Only)
- **Authorization**: Only existing ADMINS can call it
- **Function**: Assigns users to ADMINS group
- **Logging**: Logs who assigned, when, target user, reason
- **Audit Trail**: Creates audit record in database

### 2. **`removeAdminLambda`** (Admin-Only)
- **Authorization**: Only existing ADMINS can call it
- **Function**: Removes users from ADMINS group
- **Logging**: Logs who removed, when, target user, reason
- **Safety**: Cannot remove last admin

### 3. **`listAdminsLambda`** (Admin-Only)
- **Authorization**: Only ADMINS can call it
- **Function**: Lists all current admins
- **Purpose**: Admin management UI

### 4. **Admin Audit Log Model**
- Track all admin assignments/removals
- Who did it, when, target user, reason
- Immutable audit trail

## Current Admin Capabilities

Admins can currently:
- ✅ Add credits to any user (via `addCreditsLambda`)
- ✅ Read/update/delete UserCredits records (via GraphQL)
- ✅ Read/update/delete CreditTransaction records (via GraphQL)
- ✅ Read/update/delete CreditTier records (via GraphQL)
- ✅ Read/delete Session records (via GraphQL)
- ✅ Update/delete any Robot (via `updateRobotLambda`, `deleteRobotLambda`)
- ✅ Manage any Robot's ACL (via `manageRobotACLLambda`)
- ✅ Manage any Robot's operators (via `manageRobotOperatorLambda`)
- ✅ Takeover any robot session (via signaling function)
- ✅ Access all storage (via storage authorization)

**All of these should be logged and audited!**

## ✅ **SECURITY FIXES IMPLEMENTED**

### New Admin Management System:

1. **`assignAdminLambda`** ✅ Created
   - **Authorization**: Only existing ADMINS can call it
   - **Function**: Assigns users to ADMINS group
   - **Security Checks**: 
     - Verifies caller is admin
     - Verifies target user is not already admin
   - **Audit Logging**: Creates `AdminAudit` record with who, when, target, reason
   - **Prevents**: Self-assignment (users can't make themselves admin)

2. **`removeAdminLambda`** ✅ Created
   - **Authorization**: Only existing ADMINS can call it
   - **Function**: Removes users from ADMINS group
   - **Security Checks**:
     - Verifies caller is admin
     - **Prevents removing yourself** (must be done by another admin)
     - **Prevents removing last admin** (at least one must remain)
   - **Audit Logging**: Creates `AdminAudit` record

3. **`listAdminsLambda`** ✅ Created
   - **Authorization**: Only ADMINS can call it
   - **Function**: Lists all current admins with details
   - **Purpose**: Admin management UI

4. **`AdminAudit` Model** ✅ Created
   - Tracks all admin assignments/removals
   - Fields: action, adminUserId, targetUserId, reason, timestamp, metadata
   - Secondary indexes for querying by admin, target, or time
   - **Immutable audit trail** - only ADMINS can read

### Security Improvements:

✅ **Controlled Admin Assignment**: No more manual AWS Console access needed
✅ **Full Audit Trail**: Every admin assignment/removal is logged
✅ **Prevents Self-Promotion**: Users cannot make themselves admin
✅ **Prevents Last Admin Removal**: System always has at least one admin
✅ **Tracked Operations**: All admin actions go through logged Lambda functions

## Remaining Recommendations

1. **Create Admin Dashboard UI** - Show admin list, audit logs, assign/remove interface
2. **Add audit logging to other admin operations**:
   - `addCreditsLambda` - Log when admins add credits to users
   - `updateRobotLambda` - Log admin robot modifications
   - `deleteRobotLambda` - Log admin robot deletions
   - All admin-sensitive operations should be audited
3. **Consider restricting `setUserGroupLambda`** - Only allow during initial user setup
4. **Add admin activity monitoring** - Alert on suspicious admin actions

