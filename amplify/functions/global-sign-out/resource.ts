import { defineFunction } from "@aws-amplify/backend";

export const globalSignOutLambda = defineFunction({
  runtime: 22,
  resourceGroupName: "data", // Assign to data stack to avoid circular dependency
});
