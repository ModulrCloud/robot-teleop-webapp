import { defineFunction } from "@aws-amplify/backend";

export const addCredits = defineFunction({
  resourceGroupName: "data", // Assign to data stack to access DynamoDB tables
});

