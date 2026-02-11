import { defineFunction } from "@aws-amplify/backend";

export const manageOrgMember = defineFunction({
  runtime: 22,
  resourceGroupName: "data",
});
