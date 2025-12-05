import { defineStorage } from '@aws-amplify/backend';

export const storage = defineStorage({
  name: 'robotImages',
  access: (allow) => ({
    'robot-images/*': [
      allow.guest.to(['read']),
      allow.authenticated.to(['read', 'write', 'delete']),
      allow.groups(['PARTNERS', 'ADMINS', 'CLIENTS']).to(['read', 'write', 'delete']),
    ],
    'partner-logos/*': [
      allow.guest.to(['read']),
      allow.authenticated.to(['read', 'write', 'delete']),
      allow.groups(['PARTNERS', 'ADMINS']).to(['read', 'write', 'delete']),
    ],
  }),
});
