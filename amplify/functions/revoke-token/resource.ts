import { defineFunction } from "@aws-amplify/backend";

export const revokeTokenLambda = defineFunction({
  runtime: 22,
  resourceGroupName: "data", // Assign to data stack to avoid circular dependency
});

