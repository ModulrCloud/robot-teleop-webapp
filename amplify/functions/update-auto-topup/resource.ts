import { defineFunction } from "@aws-amplify/backend";

export const updateAutoTopUp = defineFunction({
  runtime: 22,
  resourceGroupName: "data", // Assign to data stack
});

