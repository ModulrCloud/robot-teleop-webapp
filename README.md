# Robot Teleop Web Application

## Setup

### Prerequisites

- Node.js (v18+) and npm
- AWS Account
- AWS CLI
- Google OAuth 2.0 credentials

### Installation

```bash
# Install dependencies
npm install

# Configure AWS credentials
npx ampx configure profile

# Set Google OAuth secrets
npx ampx sandbox secret set GOOGLE_CLIENT_ID
npx ampx sandbox secret set GOOGLE_CLIENT_SECRET

#You can verify the secret by using these commands (optional)
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
