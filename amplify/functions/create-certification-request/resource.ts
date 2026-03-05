import { defineFunction } from "@aws-amplify/backend";

export const createCertificationRequest = defineFunction({
  runtime: 22,
  resourceGroupName: "data",
});
