# Robot Teleop Web Application

## Setup

### Prerequisites

- Node.js (v18+) and npm
- AWS Account
- AWS CLI configured
- Google OAuth 2.0 credentials
- Stripe account (for payments)

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
# - AWS Region (e.g., eu-west-2)
```

### Secrets Configuration

Set the required secrets for your sandbox:

```bash
# Google OAuth
npx ampx sandbox secret set GOOGLE_CLIENT_ID
npx ampx sandbox secret set GOOGLE_CLIENT_SECRET

# Stripe (for payments)
npx ampx sandbox secret set STRIPE_SECRET_KEY
npx ampx sandbox secret set FRONTEND_URL
# Enter: http://localhost:5173
```

Verify secrets are set:

```bash
npx ampx sandbox secret list
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

### Test Cards (Stripe)

For testing payments in sandbox mode:

- Card: `4242 4242 4242 4242`
- Expiry: Any future date
- CVC: Any 3 digits
