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
