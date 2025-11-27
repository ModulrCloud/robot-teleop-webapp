# Google Cloud Console OAuth Setup Guide

## Prerequisites
- Google Workspace account (you have this ✅)
- Access to Google Cloud Console

## Step 1: Access Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Sign in with your **company Google Workspace account** (not personal Gmail)
3. If you don't have a project yet, you'll need to create one:
   - Click the project dropdown at the top
   - Click "New Project"
   - Name it (e.g., "Modulr Robot Teleop")
   - Click "Create"

## Step 2: Enable Google+ API (if needed)

1. In the left sidebar, go to **"APIs & Services"** → **"Library"**
2. Search for **"Google+ API"** or **"People API"**
3. Click on it and click **"Enable"** (if not already enabled)
   - Note: Google+ API is being deprecated, but OAuth still works. You might see "People API" instead.

## Step 3: Configure OAuth Consent Screen

1. Go to **"APIs & Services"** → **"OAuth consent screen"**
2. Choose **"Internal"** (since you have Google Workspace) or **"External"**
   - **Internal**: Only users in your Google Workspace can sign in
   - **External**: Anyone with a Google account can sign in
3. Fill in the required fields:
   - **App name**: "Modulr" or "Robot Teleop"
   - **User support email**: Your company email
   - **Developer contact information**: Your company email
4. Click **"Save and Continue"**
5. On the "Scopes" page, click **"Save and Continue"** (default scopes are fine)
6. On the "Test users" page (if External), you can add test users or skip
7. Click **"Save and Continue"** → **"Back to Dashboard"**

## Step 4: Create OAuth 2.0 Credentials

1. Go to **"APIs & Services"** → **"Credentials"**
2. Click **"+ CREATE CREDENTIALS"** at the top
3. Select **"OAuth client ID"**
4. Choose **"Web application"** as the application type
5. Give it a name (e.g., "Modulr Web App" or "Robot Teleop Local Dev")
6. **Authorized redirect URIs** - Add these:
   ```
   http://localhost:5173/
   https://main.d6wm66gzzoyhi.amplifyapp.com/
   https://app.modulr.cloud/
   ```
   
   **IMPORTANT:** You'll also need to add your Cognito Hosted UI redirect URI once your sandbox is running:
   ```
   http://[YOUR_DOMAIN_ID].auth.[REGION].amazoncognito.com/oauth2/idpresponse
   ```
   
   For example (using Kenneth's domain):
   ```
   http://5c2c7e17a01d62d5771f.auth.eu-west-2.amazoncognito.com/oauth2/idpresponse
   ```
   
   **Note:** Use `http://` (not `https://`) for Cognito Hosted UI redirects.

7. Click **"CREATE"**
8. **IMPORTANT:** A popup will show your **Client ID** and **Client Secret**
   - **Copy both immediately** - you won't be able to see the secret again!
   - If you lose it, you'll need to create new credentials

## Step 5: Get Your Cognito Domain (After Sandbox Deploys)

Once your Amplify sandbox finishes deploying:

1. Open `amplify_outputs.json` in your project
2. Find the `oauth.domain` field:
   ```json
   "domain": "f7f012e3c5f4d00c463e.auth.us-east-1.amazoncognito.com"
   ```
3. Your redirect URI will be:
   ```
   http://f7f012e3c5f4d00c463e.auth.us-east-1.amazoncognito.com/oauth2/idpresponse
   ```
   (Replace with your actual domain ID and region)

## Step 6: Add Cognito Redirect URI to Google Cloud Console

1. Go back to Google Cloud Console → **"APIs & Services"** → **"Credentials"**
2. Click on your OAuth 2.0 Client ID to edit it
3. Under **"Authorized redirect URIs"**, click **"+ ADD URI"**
4. Add your Cognito redirect URI:
   ```
   http://[YOUR_DOMAIN_ID].auth.[REGION].amazoncognito.com/oauth2/idpresponse
   ```
5. Click **"SAVE"**

## Step 7: Set Credentials in Amplify

1. Open your terminal in the project directory
2. Set the Client ID:
   ```bash
   npx ampx sandbox secret set GOOGLE_CLIENT_ID
   ```
   - When prompted, paste your **Client ID** (the long string ending in `.apps.googleusercontent.com`)
   - Press Enter

3. Set the Client Secret:
   ```bash
   npx ampx sandbox secret set GOOGLE_CLIENT_SECRET
   ```
   - When prompted, paste your **Client Secret**
   - Press Enter

4. Restart your sandbox:
   ```bash
   # Stop current sandbox (Ctrl+C if running)
   npx ampx sandbox
   ```

## Step 8: Test

1. Once sandbox is running, start your dev server:
   ```bash
   npm run dev
   ```
2. Go to `http://localhost:5173`
3. Click "Sign in with Google"
4. You should be redirected to Google sign-in, then back to your app

## Troubleshooting

### "redirect_uri_mismatch" Error
- Make sure the redirect URI in Google Cloud Console **exactly matches** what Cognito is sending
- Check that you used `http://` (not `https://`) for the Cognito redirect URI
- Wait 2-3 minutes after adding the URI for changes to propagate

### "Access blocked" Error
- If using "External" OAuth consent screen, you may need to add test users
- Or switch to "Internal" if you only want company users

### Can't find Google Cloud Console
- Make sure you're signed in with your **company Google Workspace account**
- Go to [console.cloud.google.com](https://console.cloud.google.com/)
- If you don't see it, ask your Google Workspace admin for access

## Notes

- **Client Secret is sensitive** - don't commit it to git or share it publicly
- You can have **multiple redirect URIs** in one OAuth Client ID
- Each environment (dev, staging, prod) can use the same Client ID with different redirect URIs
- Changes to Google Cloud Console settings can take 2-3 minutes to propagate

