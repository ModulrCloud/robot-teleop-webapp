import { defineFunction } from '@aws-amplify/backend';

export const listAccessibleRobots = defineFunction({
  runtime: 22,
  name: 'list-accessible-robots',
  entry: './handler.ts',
  resourceGroupName: 'data', // Assign to data stack since this is a data resolver
});

