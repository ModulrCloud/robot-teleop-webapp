import { defineFunction } from "@aws-amplify/backend";

export const listWhatsNew = defineFunction({
  runtime: 22,
  resourceGroupName: "data",
});
