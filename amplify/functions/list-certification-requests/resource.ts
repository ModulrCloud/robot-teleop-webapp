import { defineFunction } from "@aws-amplify/backend";

export const listCertificationRequests = defineFunction({
  runtime: 22,
  resourceGroupName: "data",
});
