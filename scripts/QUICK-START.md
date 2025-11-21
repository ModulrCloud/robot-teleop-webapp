# Quick Start: WebSocket Testing

## 🚀 Super Simple Usage

```bash
# 1. Start your sandbox
npx ampx sandbox

# 2. Get your token (see below)

# 3. Run the test (URL auto-detected!)
npm run test:websocket <your-token>
```

That's it! The WebSocket URL is automatically detected from `amplify_outputs.json`.

## 📋 Step-by-Step

### 1. Start Amplify Sandbox
```bash
npx ampx sandbox
```
Wait for it to finish deploying. The WebSocket URL will be in `amplify_outputs.json`.

### 2. Get Your JWT Token

**Option A: Quick Command**
```bash
npm run test:get-token
```
This shows you exactly where to find it.

**Option B: Manual**
1. Sign in to your app in the browser
2. Open DevTools (F12)
3. Go to **Application** → **Local Storage**
4. Find key ending with `.idToken`
5. Copy the value (starts with `eyJ...`)

### 3. Check WebSocket URL (Optional)
```bash
npm run test:ws-config
```
This shows what URL will be used and where it came from.

### 4. Run the Test
```bash
npm run test:websocket <your-token> [robotId]
```

**Examples:**
```bash
# Use default robotId
npm run test:websocket eyJraWQiOiJcL1VzZXJQb29sXC8...

# Specify robotId
npm run test:websocket eyJraWQiOiJcL1VzZXJQb29sXC8... robot1
```

## 🔍 What Gets Auto-Detected?

The script automatically finds the WebSocket URL in this order:

1. ✅ **`amplify_outputs.json`** → `custom.signaling.websocketUrl` (when sandbox is running)
2. ✅ **`VITE_WS_URL`** environment variable
3. ✅ **Local fallback** → `ws://192.168.132.19:8765`

## 🎯 What the Test Does

- ✅ Connects robot and registers it
- ✅ Connects client and sends offer
- ✅ Verifies message forwarding
- ✅ Tests authorization/delegation

## 🐛 Troubleshooting

**"Using local fallback" warning?**
- Make sure `npx ampx sandbox` is running
- Check that `amplify_outputs.json` exists
- Verify it contains `custom.signaling.websocketUrl`

**"Unauthorized" error?**
- Your token might be expired - get a fresh one
- Make sure you're signed in to the app

**Messages not forwarding?**
- Check CloudWatch logs for `[PACKET_FORWARD]` entries
- Verify both connections are active

## 📚 More Info

See `scripts/README-TESTING.md` for detailed documentation.

