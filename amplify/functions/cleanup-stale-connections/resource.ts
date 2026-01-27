import { defineFunction } from '@aws-amplify/backend';

export const cleanupStaleConnections = defineFunction({
  runtime: 22,
  name: 'cleanup-stale-connections',
  entry: './handler.ts',
  resourceGroupName: 'data',
});

