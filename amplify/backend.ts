import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { setUserGroup } from './functions/set-user-group/resource';

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */
const backend = defineBackend({
  auth,
  data,
  setUserGroup,
});

const userPool = backend.auth.resources.userPool;
const setUserGroupFunction = backend.setUserGroup.resources.lambda;
userPool.grant(setUserGroupFunction, 'cognito-idp:AdminAddUserToGroup');
backend.setUserGroup.addEnvironment('USER_POOL_ID', userPool.userPoolId);
