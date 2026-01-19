import { defineFunction } from "@aws-amplify/backend";

export const deleteRobotLambda = defineFunction({
  runtime: 22,
  resourceGroupName: "data", // Assign to data stack
});

