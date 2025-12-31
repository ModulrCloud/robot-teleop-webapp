import { defineFunction } from '@aws-amplify/backend';

export const getActiveRobots = defineFunction({
  name: 'get-active-robots',
  entry: './handler.ts',
  resourceGroupName: 'data',
});

