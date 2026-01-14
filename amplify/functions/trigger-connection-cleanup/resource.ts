import { defineFunction } from '@aws-amplify/backend';

export const triggerConnectionCleanup = defineFunction({
  runtime: 22,
  name: 'trigger-connection-cleanup',
  entry: './handler.ts',
  resourceGroupName: 'data',
});

