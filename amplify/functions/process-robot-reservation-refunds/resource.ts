import { defineFunction } from '@aws-amplify/backend';

export const processRobotReservationRefunds = defineFunction({
  name: 'process-robot-reservation-refunds',
  entry: './handler.ts',
  resourceGroupName: "data",
});

