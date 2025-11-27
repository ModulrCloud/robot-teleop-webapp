/**
 * Helper script to extract JWT token from browser localStorage
 * 
 * This script provides instructions for getting the token manually.
 * In the future, this could be automated with browser automation tools.
 */

console.log('🔑 How to Get Your JWT Token\n');
console.log('=====================================\n');
console.log('Method 1: Browser DevTools (Recommended)\n');
console.log('1. Sign in to your app in the browser');
console.log('2. Open DevTools (F12 or Right-click → Inspect)');
console.log('3. Go to Application tab (Chrome) or Storage tab (Firefox)');
console.log('4. Click on "Local Storage" in the left sidebar');
console.log('5. Select your domain (e.g., http://localhost:5173)');
console.log('6. Look for a key containing "CognitoIdentityServiceProvider"');
console.log('7. Find the key that ends with ".idToken"');
console.log('8. Copy the value (it starts with "eyJ...")\n');
console.log('Method 2: Browser Console\n');
console.log('1. Sign in to your app');
console.log('2. Open DevTools Console (F12)');
console.log('3. Run this command:');
console.log('   localStorage.getItem(Object.keys(localStorage).find(k => k.includes("idToken")))');
console.log('4. Copy the returned value\n');
console.log('Method 3: Network Tab\n');
console.log('1. Sign in to your app');
console.log('2. Open DevTools → Network tab');
console.log('3. Filter by "WS" or "WebSocket"');
console.log('4. Click on the WebSocket connection');
console.log('5. Look at the "Request URL" - it will have ?token=...');
console.log('6. Copy the token value from the URL\n');
console.log('=====================================\n');
console.log('Once you have the token, use it with the test script:');
console.log('  npx tsx scripts/test-websocket-local.ts <your-token> [robotId]\n');

