import { defineFunction } from '@aws-amplify/backend';

export const triggerConnectionCleanup = defineFunction({
  name: 'trigger-connection-cleanup',
  entry: './handler.ts',
  resourceGroupName: 'data',
});

