import { defineFunction } from "@aws-amplify/backend";

export const manageOrganization = defineFunction({
  runtime: 22,
  resourceGroupName: "data",
});
