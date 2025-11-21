/**
 * Helper script to get WebSocket configuration
 * Automatically reads from amplify_outputs.json or falls back to local
 */

import { readFileSync } from 'fs';
import { join } from 'path';

export interface WebSocketConfig {
  wsUrl: string;
  source: 'amplify_outputs' | 'env' | 'local_fallback';
}

/**
 * Gets the WebSocket URL from amplify_outputs.json or falls back to local
 */
export function getWebSocketUrl(): WebSocketConfig {
  const projectRoot = process.cwd();
  const outputsPath = join(projectRoot, 'amplify_outputs.json');

  try {
    // Try to read from amplify_outputs.json
    const outputsContent = readFileSync(outputsPath, 'utf-8');
    const outputs = JSON.parse(outputsContent);

    if (outputs?.custom?.signaling?.websocketUrl) {
      return {
        wsUrl: outputs.custom.signaling.websocketUrl,
        source: 'amplify_outputs',
      };
    }
  } catch (error) {
    // File doesn't exist or invalid JSON - that's okay, we'll use fallback
  }

  // Check environment variable
  if (process.env.VITE_WS_URL) {
    return {
      wsUrl: process.env.VITE_WS_URL,
      source: 'env',
    };
  }

  // Default local fallback (same as Teleop.tsx)
  return {
    wsUrl: 'ws://192.168.132.19:8765',
    source: 'local_fallback',
  };
}

/**
 * Prints the WebSocket URL and source for user reference
 */
export function printWebSocketConfig(): void {
  const config = getWebSocketUrl();
  console.log('📡 WebSocket Configuration:');
  console.log(`   URL: ${config.wsUrl}`);
  console.log(`   Source: ${config.source}`);
  console.log('');
  
  if (config.source === 'local_fallback') {
    console.log('⚠️  Using local fallback. Make sure:');
    console.log('   1. Your Amplify sandbox is running (npx ampx sandbox)');
    console.log('   2. amplify_outputs.json exists and contains custom.signaling.websocketUrl');
    console.log('   3. Or set VITE_WS_URL environment variable');
    console.log('');
  }
}

// If run directly via tsx, print the config
// This will execute when the file is run directly
if (process.argv[1] && process.argv[1].endsWith('get-websocket-config.ts')) {
  printWebSocketConfig();
}

