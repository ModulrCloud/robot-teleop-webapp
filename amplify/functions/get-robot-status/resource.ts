import { defineFunction } from '@aws-amplify/backend';

export const getRobotStatus = defineFunction({
  runtime: 22,
  name: 'get-robot-status',
  entry: './handler.ts',
  resourceGroupName: 'data', // Assign to data stack since this is a data resolver
});


