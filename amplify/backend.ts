import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { setUserGroupLambda } from './functions/set-user-group/resource';
import { setRobotLambda } from './functions/set-robot/resource';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */
const backend = defineBackend({
  auth,
  data,
  setUserGroupLambda,
  setRobotLambda,
});

const userPool = backend.auth.resources.userPool;
const tables = backend.data.resources.tables;
const setUserGroupLambdaFunction = backend.setUserGroupLambda.resources.lambda;
const setRobotLambdaFunction = backend.setRobotLambda.resources.lambda;

// Lambda environment variables
backend.setUserGroupLambda.addEnvironment('USER_POOL_ID', userPool.userPoolId);
backend.setRobotLambda.addEnvironment('ROBOT_TABLE_NAME', tables.Robot.tableName);
backend.setRobotLambda.addEnvironment('PARTNER_TABLE_NAME', tables.Partner.tableName);

// Lambda permissions
userPool.grant(setUserGroupLambdaFunction, 'cognito-idp:AdminAddUserToGroup');
tables.Partner.grantReadData(setRobotLambdaFunction);
setRobotLambdaFunction.addToRolePolicy(new PolicyStatement({
  actions: ["dynamodb:Query", "dynamodb:GetItem", "dynamodb:Scan"],
    resources: [
      `${tables.Partner.tableArn}/index/cognitoUsernameIndex`
    ]
}));
tables.Robot.grantWriteData(setRobotLambdaFunction);
