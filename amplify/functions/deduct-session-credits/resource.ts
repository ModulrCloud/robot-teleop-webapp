import { defineFunction } from "@aws-amplify/backend";

export const deductSessionCredits = defineFunction({
  runtime: 22,
  resourceGroupName: "data",
});

