import { defineFunction, secret } from "@aws-amplify/backend";

export const verifyStripePayment = defineFunction({
  resourceGroupName: "data", // Assign to data stack (used as GraphQL mutation resolver)
  environment: {
    STRIPE_SECRET_KEY: secret('STRIPE_SECRET_KEY'),
  },
});

