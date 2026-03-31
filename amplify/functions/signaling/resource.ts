import { defineFunction, secret } from "@aws-amplify/backend";

export const signaling = defineFunction({
  runtime: 22,
  resourceGroupName: "data", // Assign to data stack to avoid circular dependency with user pool
  environment: {
    TURN_TOKEN_ID: secret('TURN_TOKEN_ID'),
    TURN_API_TOKEN: secret('TURN_API_TOKEN'),
  },
});