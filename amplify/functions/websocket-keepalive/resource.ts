import { defineFunction } from '@aws-amplify/backend';

export const websocketKeepalive = defineFunction({
  name: 'websocket-keepalive',
  entry: './handler.ts',
  resourceGroupName: 'data',
});

