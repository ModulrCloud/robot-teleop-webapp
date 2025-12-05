import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { setUserGroupLambda } from "../functions/set-user-group/resource";
import { setRobotLambda } from "../functions/set-robot/resource";
import { updateRobotLambda } from "../functions/update-robot/resource";
import { revokeTokenLambda } from "../functions/revoke-token/resource";
import { manageRobotOperator } from "../functions/manage-robot-operator/resource";
import { deleteRobotLambda } from "../functions/delete-robot/resource";
import { manageRobotACL } from "../functions/manage-robot-acl/resource";
import { listAccessibleRobots } from "../functions/list-accessible-robots/resource";
import { getRobotStatus } from "../functions/get-robot-status/resource";

const LambdaResult = a.customType({
  statusCode: a.integer(),
  body: a.string(),
});

const RobotStatus = a.customType({
  isOnline: a.boolean(),
  lastSeen: a.integer(), // Optional by default in custom types
  status: a.string(), // Optional by default in custom types
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
    logoUrl: a.string(),
    websiteUrl: a.string(),
    contactEmail: a.string(),
    companyType: a.string(),
    integrationCode: a.string(),
    integrationDocsUrl: a.string(),
    isPublicProfile: a.boolean(),
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
    allowedUsers: a.string().array(), // Optional: if null/empty, robot is open access. If set, only listed users can access.
    imageUrl: a.string(),
    // Location fields
    city: a.string(),
    state: a.string(),
    country: a.string(),
    latitude: a.float(),
    longitude: a.float(),
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
      enableAccessControl: a.boolean(), // Optional: if true, creates ACL with default users
      additionalAllowedUsers: a.string().array(), // Optional: additional email addresses to add to ACL
      imageUrl: a.string(),
      // Location fields
      city: a.string(),
      state: a.string(),
      country: a.string(),
      latitude: a.float(),
      longitude: a.float(),
    })
    .returns(a.string())
    .authorization(allow => [allow.group('PARTNERS'), allow.group('ADMINS')])
    .handler(a.handler.function(setRobotLambda)),

  updateRobotLambda: a
    .mutation()
    .arguments({
      robotId: a.string().required(), // Robot ID (UUID) to update
      robotName: a.string(), // Optional: update name
      description: a.string(), // Optional: update description
      model: a.string(), // Optional: update model
      enableAccessControl: a.boolean(), // Optional: update ACL (true = enable/update, false = disable/remove)
      additionalAllowedUsers: a.string().array(), // Optional: additional email addresses to add to ACL (only used if enableAccessControl is true)
      imageUrl: a.string(), // Optional: update imageUrl
      // Location fields (optional)
      city: a.string(),
      state: a.string(),
      country: a.string(),
      latitude: a.float(),
      longitude: a.float(),
    })
    .returns(a.string())
    .authorization(allow => [allow.authenticated()]) // Auth handled in Lambda (owner/admin check)
    .handler(a.handler.function(updateRobotLambda)),

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
    .handler(a.handler.function(manageRobotOperator)),

  deleteRobotLambda: a
    .mutation()
    .arguments({
      robotId: a.string().required(), // Robot ID (UUID) to delete
    })
    .returns(LambdaResult)
    .authorization(allow => [allow.authenticated()]) // Auth handled in Lambda (owner/admin check)
    .handler(a.handler.function(deleteRobotLambda)),

  manageRobotACLLambda: a
    .mutation()
    .arguments({
      robotId: a.string().required(), // Robot ID (UUID) to manage ACL for
      userEmail: a.string(), // Email address to add/remove (required for 'add'/'remove' actions)
      action: a.string().required(), // 'add', 'remove', or 'delete' (delete removes entire ACL)
    })
    .returns(LambdaResult)
    .authorization(allow => [allow.authenticated()]) // Auth handled in Lambda (owner/admin check)
    .handler(a.handler.function(manageRobotACL)),

  listAccessibleRobotsLambda: a
    .query()
    .arguments({
      limit: a.integer(), // Optional: number of robots to return (default: 50)
      nextToken: a.string(), // Optional: pagination token from previous request
    })
    .returns(a.json()) // Return JSON object with robots array and nextToken
    .authorization(allow => [allow.authenticated()]) // Auth handled in Lambda (filters by ACL)
    .handler(a.handler.function(listAccessibleRobots)),

  getRobotStatusLambda: a
    .query()
    .arguments({
      robotId: a.string().required(), // robotId (robot-XXXXXXXX format)
    })
    .returns(RobotStatus)
    .authorization(allow => [allow.authenticated()]) // Auth handled in Lambda (checks ACL)
    .handler(a.handler.function(getRobotStatus))
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
