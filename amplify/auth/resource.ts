import { defineAuth, secret } from '@aws-amplify/backend';

/**
 * Define and configure your auth resource
 * @see https://docs.amplify.aws/gen2/build-a-backend/auth
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
    externalProviders: {
      google: {
        clientId: secret('GOOGLE_CLIENT_ID'),
        clientSecret: secret('GOOGLE_CLIENT_SECRET'),
        scopes: ["email", "profile", "openid"],
      },
      callbackUrls: [
        'http://localhost:5173/',
        'https://main.d6wm66gzzoyhi.amplifyapp.com/',
        'https://main.d15x0q3z32oqjv.amplifyapp.com/',
        'https://app.modulr.cloud/',
        'https://ap.app.modulr.cloud/',
      ],
      logoutUrls: [
        'http://localhost:5173/',
        'https://main.d6wm66gzzoyhi.amplifyapp.com/',
        'https://main.d15x0q3z32oqjv.amplifyapp.com/',
        'https://app.modulr.cloud/',
        'https://ap.app.modulr.cloud/',
      ],
    },
  },
  groups: ["ADMINS", "PARTNERS", "CLIENTS"],
});
