# JWT Token Security - Important Considerations

## The Problem You Identified

**Yes, your concern is valid!** Here's what happens:

### Current Behavior
1. **User signs in** → Gets JWT token (stored in localStorage)
2. **User signs out** → Token is removed from localStorage, but **the token itself is still valid**
3. **If someone copied the token** → They can use it until it expires (typically 1 hour)

### Why This Happens
- **JWTs are stateless** - Once issued, they're valid until expiration
- **Sign-out only removes tokens from client** - Doesn't invalidate them on the server
- **No token blacklist** - Server doesn't track which tokens are "revoked"

## Current Security Issues

### 🔴 CRITICAL: Signaling Server Doesn't Verify Tokens
Your signaling server uses `decodeJwtNoVerify()` which **doesn't verify the token signature**. This means:
- Anyone can create a fake token and it will be accepted
- No way to know if the token is legitimate
- **This must be fixed before production!**

### 🟡 Medium: Tokens in localStorage
- Vulnerable to XSS (Cross-Site Scripting) attacks
- Any malicious JavaScript can read tokens
- Consider httpOnly cookies (requires backend changes)

## Solutions

### 1. ✅ Fix Token Verification (REQUIRED)
The signaling server must verify JWT tokens using Cognito's public keys. See implementation below.

### 2. ✅ Short Token Expiration (Already Good)
- Cognito tokens typically expire in 1 hour
- This limits the window of vulnerability
- Consider reducing to 15-30 minutes for high-security operations

### 3. ⚠️ Token Blacklisting (Optional, Complex)
- Maintain a database of revoked tokens
- Check blacklist on every request
- Adds latency and complexity
- Usually not needed if tokens expire quickly

### 4. ⚠️ Refresh Tokens (Already Implemented)
- Cognito uses refresh tokens
- Access tokens are short-lived
- Refresh tokens can be revoked server-side

## Best Practices

1. **Always verify JWT signatures** - Never trust unverified tokens
2. **Use short expiration times** - 15-60 minutes for access tokens
3. **Implement proper token storage** - httpOnly cookies when possible
4. **Monitor for suspicious activity** - Log failed token verifications
5. **Use HTTPS everywhere** - Prevent token interception

## What Happens on Sign-Out

### Current Implementation
```typescript
await amplifySignOut({ global: true });  // Tells Cognito user signed out
localStorage.clear();  // Removes tokens from client
```

### What This Does
- ✅ Removes tokens from client (user can't use them in browser)
- ✅ Tells Cognito the user signed out (for analytics)
- ❌ **Does NOT invalidate existing tokens** (they're still valid until expiration)

### What This Means
- If someone **copies the token before sign-out**, they can use it until expiration
- This is a **known limitation of JWTs** - they're designed to be stateless
- **Mitigation**: Short expiration times (1 hour is standard)

## Recommendations for Your App

### Immediate (Before Production)
1. **Fix token verification in signaling server** - See code below
2. **Add token expiration checks** - Reject expired tokens
3. **Add logging** - Track failed authentication attempts

### Future Enhancements
1. **Token blacklisting** - For critical operations (robot control)
2. **Session management** - Track active sessions per user
3. **Rate limiting** - Prevent token brute force attacks
4. **Security monitoring** - Alert on suspicious patterns

## Implementation: Proper JWT Verification

See the updated `handler.ts` code that verifies tokens using Cognito's public keys.

