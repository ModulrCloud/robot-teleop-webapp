import { defineFunction, secret } from "@aws-amplify/backend";

export const createStripeConnectOnboardingLink = defineFunction({
  runtime: 22,
  resourceGroupName: "data",
  environment: {
    STRIPE_SECRET_KEY: secret("STRIPE_SECRET_KEY"),
  },
});
