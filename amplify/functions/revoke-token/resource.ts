import { defineFunction } from "@aws-amplify/backend";

export const revokeTokenLambda = defineFunction({
  resourceGroupName: "data", // Assign to data stack to avoid circular dependency
});

