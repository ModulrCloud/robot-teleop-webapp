import { defineFunction } from "@aws-amplify/backend";

export const regenerateEnrollmentToken = defineFunction({
  runtime: 22,
  resourceGroupName: "data",
});
