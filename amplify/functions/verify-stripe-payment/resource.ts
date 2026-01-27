import { defineFunction, secret } from "@aws-amplify/backend";

export const verifyStripePayment = defineFunction({
  runtime: 22,
  resourceGroupName: "data", // Assign to data stack (used as GraphQL mutation resolver)
  environment: {
    STRIPE_SECRET_KEY: secret('STRIPE_SECRET_KEY'),
  },
});

