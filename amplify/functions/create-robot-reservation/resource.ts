import { defineFunction } from "@aws-amplify/backend";

export const createRobotReservation = defineFunction({
  resourceGroupName: "data", // Assign to data stack since this is a GraphQL resolver
});

