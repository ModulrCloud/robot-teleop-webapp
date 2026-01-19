import { defineFunction } from '@aws-amplify/backend';

export const websocketKeepalive = defineFunction({
  runtime: 22,
  name: 'websocket-keepalive',
  entry: './handler.ts',
  resourceGroupName: 'data',
});

