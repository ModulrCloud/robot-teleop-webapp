import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { setUserGroupLambda } from "../functions/set-user-group/resource";
import { setRobotLambda } from "../functions/set-robot/resource";
import { revokeTokenLambda } from "../functions/revoke-token/resource";
import { manageRobotOperator } from "../functions/manage-robot-operator/resource";

const LambdaResult = a.customType({
  statusCode: a.integer(),
  body: a.string(),
});

const schema = a.schema({
  // Join table between partners and tags
  PartnerTag: a.model({
    partnerId: a.id().required(),
    tagId: a.id().required(),
    partner: a.belongsTo('Partner', 'partnerId'),
    tag: a.belongsTo('Tag', 'tagId'),
  })
  .authorization((allow) => [
    allow.authenticated().to(['read']),
  ]),

  // Join table between clients and tags
  ClientTag: a.model({
    clientId: a.id().required(),
    tagId: a.id().required(),
    client: a.belongsTo('Client', 'clientId'),
    tag: a.belongsTo('Tag', 'tagId'),
  })
  .authorization((allow) => [
    allow.authenticated().to(['read']),
  ]),

  // Descriptive tags for types of robots/services available
  Tag: a.model({
    name: a.string().required(),
    description: a.string(),
    partners: a.hasMany('PartnerTag', 'tagId'),
    clients: a.hasMany('ClientTag', 'tagId'),
  })
  .authorization((allow) => [
    allow.authenticated().to(['read']),
  ]),

  // Table containing partner details
  Partner: a.model({
    id: a.id(),
    cognitoUsername: a.string().authorization(allow => [allow.owner()]),
    name: a.string().required(),
    description: a.string().required(),
    publicKey: a.string(),
    averageRating: a.float(),
    reliabilityScore: a.float(),
    tags: a.hasMany('PartnerTag', 'partnerId'),
    robots: a.hasMany('Robot', 'partnerId'),
  })
  .secondaryIndexes(index => [index("cognitoUsername").name("cognitoUsernameIndex")])
  .authorization((allow) => [
    allow.authenticated().to(['read']),
    allow.owner(),
  ]),

  // Table containing client details
  Client: a.model({
    id: a.id(),
    cognitoUsername: a.string().authorization(allow => [allow.owner()]),
    publicKey: a.string(),
    averageRating: a.float(),
    reliabilityScore: a.float(),
    tags: a.hasMany('ClientTag', 'clientId'),
  })
  .secondaryIndexes(index => [index("cognitoUsername").name("cognitoUsernameIndex")])
  .authorization((allow) => [
    allow.authenticated().to(['read']),
    allow.owner(),
  ]),

  Robot: a.model({
    id: a.id(),
    name: a.string().required(),
    description: a.string().required(),
    model: a.string(),
    robotId: a.string(),
    partnerId: a.id().required(),
    partner: a.belongsTo('Partner', 'partnerId'),
  })
  .authorization((allow) => [
    allow.owner().to(["update", "delete"]),
    allow.authenticated().to(["read"]),
  ]),

  // Delegation table: Partners can assign operators to their robots
  RobotOperator: a.model({
    id: a.id(),
    robotId: a.string().required(), // The robotId string (not Robot.id) - used for lookup
    operatorUserId: a.string().required(), // Cognito user ID (sub) of the delegated operator
    operatorUsername: a.string(), // Username for display purposes
    assignedBy: a.string().required(), // Cognito user ID who assigned this delegation
    assignedAt: a.string().required(), // ISO timestamp
  })
  .secondaryIndexes(index => [
    index("robotId").name("robotIdIndex"),
    index("operatorUserId").name("operatorUserIdIndex"),
  ])
  .authorization((allow) => [
    allow.authenticated().to(["read"]),
    allow.owner(), // Only the partner who owns the robot can manage operators
  ]),

  setUserGroupLambda: a
    .mutation()
    .arguments({
      group: a.string(),
    })
    .returns(LambdaResult)
    .authorization(allow => [allow.authenticated()])
    .handler(a.handler.function(setUserGroupLambda)),

  setRobotLambda: a
    .mutation()
    .arguments({
      robotName: a.string().required(),
      description: a.string(),
      model: a.string(),
    })
    .returns(a.string())
    .authorization(allow => [allow.group('PARTNERS'), allow.group('ADMINS')])
    .handler(a.handler.function(setRobotLambda)),

  revokeTokenLambda: a
    .mutation()
    .arguments({
      token: a.string().required(),
    })
    .returns(LambdaResult)
    .authorization(allow => [allow.authenticated()])
    .handler(a.handler.function(revokeTokenLambda)),

  manageRobotOperatorLambda: a
    .mutation()
    .arguments({
      robotId: a.string().required(),
      operatorUserId: a.string().required(),
      operatorUsername: a.string(),
      action: a.string().required(), // 'add' or 'remove'
    })
    .returns(LambdaResult)
    .authorization(allow => [allow.authenticated()])
    .handler(a.handler.function(manageRobotOperator))
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
