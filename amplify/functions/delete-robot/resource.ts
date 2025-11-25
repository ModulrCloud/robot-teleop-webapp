import { defineFunction } from "@aws-amplify/backend";

export const deleteRobotLambda = defineFunction({
  resourceGroupName: "data", // Assign to data stack
});

