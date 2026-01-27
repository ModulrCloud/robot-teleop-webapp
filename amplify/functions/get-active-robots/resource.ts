import { defineFunction } from '@aws-amplify/backend';

export const getActiveRobots = defineFunction({
  runtime: 22,
  name: 'get-active-robots',
  entry: './handler.ts',
  resourceGroupName: 'data',
});

