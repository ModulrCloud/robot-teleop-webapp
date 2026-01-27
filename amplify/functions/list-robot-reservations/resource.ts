import { defineFunction } from "@aws-amplify/backend";

export const listRobotReservations = defineFunction({
  runtime: 22,
  resourceGroupName: "data", // Assign to data stack since this is a GraphQL resolver
});

