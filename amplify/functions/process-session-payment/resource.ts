import { defineFunction } from "@aws-amplify/backend";

export const processSessionPayment = defineFunction({
  resourceGroupName: "data", // Assign to data stack to access DynamoDB tables
});

