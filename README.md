# Robot Teleop Web Application

## Setup

### Prerequisites

- Node.js (v18+) and npm
- AWS Account
- AWS CLI
- Google OAuth 2.0 credentials

Create an AWS access key:
AWS Console → Your User → Security Credentials → Access Keys → Create Access Key

### Installation

```bash
# Install dependencies
npm install

# Configure your Amplify profile:
npx ampx configure profile

# When prompted, enter:
# - AWS Access Key ID
# - AWS Secret Access Key
# - AWS Region (e.g., us-east-1)

# Set Google OAuth ID (type command, then the ID)
npx ampx sandbox secret set GOOGLE_CLIENT_ID

# Set Google OAuth secret (type command, then the secret)
npx ampx sandbox secret set GOOGLE_CLIENT_SECRET

# You can verify the secret by using these commands (optional)
npx ampx sandbox secret get GOOGLE_CLIENT_ID
npx ampx sandbox secret get GOOGLE_CLIENT_SECRET

# 3. Install backend SDKs for signaling
npm install @aws-sdk/client-dynamodb @aws-sdk/client-apigatewaymanagementapi
npm install -D @types/aws-lambda
```

### Running Locally

Start the Amplify sandbox (keep running):
```bash
npx ampx sandbox
```

In a separate terminal, start the dev server:
```bash
npm run dev
```

App runs at [http://localhost:5173](http://localhost:5173)
