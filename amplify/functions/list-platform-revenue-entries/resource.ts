import { defineFunction } from "@aws-amplify/backend";

export const listPlatformRevenueEntries = defineFunction({
  runtime: 22,
  resourceGroupName: "data",
});
