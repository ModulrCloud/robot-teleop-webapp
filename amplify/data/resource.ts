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
    twitterUrl: a.string(),
    telegramUrl: a.string(),
    githubUrl: a.string(),
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
    preferredCurrency: a.string(), // User's preferred currency (e.g., 'USD', 'EUR', 'GBP')
    tags: a.hasMany('ClientTag', 'clientId'),
  })
  .secondaryIndexes(index => [index("cognitoUsername").name("cognitoUsernameIndex")])
  .authorization((allow) => [
    allow.authenticated().to(['read']),
    allow.owner(),
  ]),

  // Master credits table - only Modulr (admins/Lambdas) can modify
  UserCredits: a.model({
    id: a.id(),
    userId: a.string().required(), // Cognito username - unique identifier
    userType: a.string(), // 'CLIENT' or 'PARTNER' (optional, for future filtering)
    credits: a.integer().default(0), // Current credit balance
    autoTopUpEnabled: a.boolean().default(false), // User preference
    autoTopUpThreshold: a.integer(), // Credits threshold (e.g., 100)
    autoTopUpTier: a.string(), // Which tier to auto-purchase ('20', '50', '100')
    stripeCustomerId: a.string(), // Stripe customer ID for saved payment methods
    stripePaymentMethodId: a.string(), // Saved payment method ID for auto top-up
    lastUpdated: a.datetime(), // When credits were last modified
  })
  .secondaryIndexes(index => [
    index("userId").name("userIdIndex"), // For quick lookups
  ])
  .authorization((allow) => [
    // Authenticated users can read (filtering by userId happens in app code)
    allow.authenticated().to(['read']),
    // Only ADMINS can create/update (Modulr control)
    allow.groups(['ADMINS']).to(['create', 'read', 'update', 'delete']),
  ]),

  // Credit transaction history
  CreditTransaction: a.model({
    id: a.id(),
    userId: a.string().required(), // Cognito username
    amount: a.integer().required(), // Credits added (positive) or deducted (negative)
    pricePaid: a.float(), // Dollar amount paid (if purchase)
    currency: a.string(), // Currency code (e.g., 'USD', 'EUR')
    tier: a.string(), // Which tier was purchased ('20', '50', '100') or null if deduction
    stripePaymentIntentId: a.string(), // Stripe payment intent ID (for purchases)
    transactionType: a.string().required(), // 'purchase', 'deduction', 'refund', 'bonus'
    description: a.string(), // Human-readable description
    createdAt: a.datetime().required(),
  })
  .secondaryIndexes(index => [
    index("userId").name("userIdIndex"), // For user transaction history
    index("createdAt").name("createdAtIndex"), // For sorting by date
  ])
  .authorization((allow) => [
    // Authenticated users can read (filtering by userId happens in app code)
    allow.authenticated().to(['read']),
    // Only ADMINS can create (via Lambda after Stripe verification)
    allow.groups(['ADMINS']).to(['create', 'read']),
  ]),

  // Dynamic credit tier configuration (supports sales/offers)
  CreditTier: a.model({
    id: a.id(),
    tierId: a.string().required(), // '20', '50', '100' - unique identifier
    name: a.string().required(), // Display name (e.g., "Starter Pack", "Pro Pack")
    basePrice: a.float().required(), // Base price in USD (e.g., 20.00)
    baseCredits: a.integer().required(), // Base credits (e.g., 1000)
    bonusCredits: a.integer().default(0), // Bonus credits (e.g., 100)
    isActive: a.boolean().default(true), // Whether tier is available for purchase
    isOnSale: a.boolean().default(false), // Whether tier is currently on sale
    salePrice: a.float(), // Sale price if on sale (e.g., 15.00)
    saleBonusCredits: a.integer(), // Extra bonus credits during sale
    saleStartDate: a.datetime(), // When sale starts
    saleEndDate: a.datetime(), // When sale ends
    description: a.string(), // Marketing description
    displayOrder: a.integer(), // Order to display tiers (1, 2, 3)
    createdAt: a.datetime(),
    updatedAt: a.datetime(),
  })
  .secondaryIndexes(index => [
    index("tierId").name("tierIdIndex"), // For quick tier lookups
  ])
  .authorization((allow) => [
    // Everyone can read tiers (for purchase UI - filtering by isActive happens in app code)
    allow.authenticated().to(['read']),
    // Only ADMINS can create/update (Modulr control for sales/offers)
    allow.groups(['ADMINS']).to(['create', 'read', 'update', 'delete']),
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

  // Session history for teleoperation sessions
  Session: a.model({
    id: a.id(),
    userId: a.string().required(),        // Cognito username of the user
    userEmail: a.string(),                // User's email for display
    robotId: a.string().required(),       // Robot's robotId (robot-XXXXXXXX)
    robotName: a.string(),                // Robot name for display
    partnerId: a.string(),                // Partner who owns the robot
    startedAt: a.datetime().required(),   // When session started
    endedAt: a.datetime(),                // When session ended
    durationSeconds: a.integer(),         // Total duration in seconds
    status: a.string(),                   // 'active', 'completed', 'disconnected'
  })
  .secondaryIndexes(index => [
    index("userId").name("userIdIndex"),
    index("partnerId").name("partnerIdIndex"),
    index("robotId").name("robotIdIndex")
  ])
  .authorization((allow) => [
    allow.owner().to(['create', 'read', 'update']),
    allow.groups(['ADMINS']).to(['read', 'delete']),
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
