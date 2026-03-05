import { defineFunction } from "@aws-amplify/backend";

export const processCertificationPayment = defineFunction({
  runtime: 22,
  resourceGroupName: "data",
});
