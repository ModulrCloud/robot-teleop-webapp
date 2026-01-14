import { defineFunction } from "@aws-amplify/backend";

export const processSessionPayment = defineFunction({
  runtime: 22,
  resourceGroupName: "data", // Assign to data stack to access DynamoDB tables
});

