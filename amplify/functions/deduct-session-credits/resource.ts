import { defineFunction } from "@aws-amplify/backend";

export const deductSessionCredits = defineFunction({
  resourceGroupName: "data",
});

