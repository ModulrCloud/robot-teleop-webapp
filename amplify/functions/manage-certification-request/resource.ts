import { defineFunction } from "@aws-amplify/backend";

export const manageCertificationRequest = defineFunction({
  runtime: 22,
  resourceGroupName: "data",
});
