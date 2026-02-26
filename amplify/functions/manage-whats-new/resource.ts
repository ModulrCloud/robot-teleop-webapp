import { defineFunction } from "@aws-amplify/backend";

export const manageWhatsNew = defineFunction({
  runtime: 22,
  resourceGroupName: "data",
});
