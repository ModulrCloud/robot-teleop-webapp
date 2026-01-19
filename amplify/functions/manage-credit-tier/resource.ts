import { defineFunction } from "@aws-amplify/backend";

export const manageCreditTier = defineFunction({
  runtime: 22,
  resourceGroupName: "data",
});

