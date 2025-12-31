import { defineFunction } from '@aws-amplify/backend';

export const cleanupStaleConnections = defineFunction({
  name: 'cleanup-stale-connections',
  entry: './handler.ts',
  resourceGroupName: 'data',
});

