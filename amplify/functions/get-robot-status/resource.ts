import { defineFunction } from '@aws-amplify/backend';

export const getRobotStatus = defineFunction({
  name: 'get-robot-status',
  entry: './handler.ts',
  resourceGroupName: 'data', // Assign to data stack since this is a data resolver
});


