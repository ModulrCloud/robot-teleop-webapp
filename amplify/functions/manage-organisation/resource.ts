import { defineFunction } from "@aws-amplify/backend";

export const manageOrganisation = defineFunction({
  runtime: 22,
  resourceGroupName: "data",
});
