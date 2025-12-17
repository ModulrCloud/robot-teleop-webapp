import { Amplify } from 'aws-amplify'
import outputs from '../amplify_outputs.json'
import { logger } from './utils/logger';

// CRITICAL: Import auth module AFTER configuration to ensure it sees the config
// We'll do this in a way that doesn't block module loading

// Configure Amplify - this must run before any other Amplify imports
if (!outputs || !outputs.auth) {
  const errorMsg = 'Amplify configuration is missing or invalid. Make sure:\n' +
    '1. The Amplify sandbox is running (npx ampx sandbox)\n' +
    '2. amplify_outputs.json exists in the project root\n' +
    '3. The file contains valid auth configuration';
  logger.error(errorMsg, outputs);
  throw new Error(errorMsg);
}

// Debug logging (commented out - uncomment for debugging)
// logger.log('Configuring Amplify with auth region:', outputs.auth?.aws_region);
// logger.log('Auth config:', {
//   userPoolId: outputs.auth.user_pool_id,
//   region: outputs.auth.aws_region,
//   clientId: outputs.auth.user_pool_client_id,
//   hasOAuth: !!outputs.auth.oauth
// });

try {
  // Try using outputs directly first - Amplify v6 should handle amplify_outputs.json format
  // If that doesn't work, we'll transform it
  Amplify.configure(outputs);
  
  let config = Amplify.getConfig();
  // Debug logging (commented out - uncomment for debugging)
  // logger.log('After configure with outputs:', {
  //   hasAuth: !!config.Auth,
  //   hasCognito: !!config.Auth?.Cognito,
  //   hasRegion: !!config.Auth?.Cognito?.region,
  //   regionValue: config.Auth?.Cognito?.region
  // });
  
  // If region is missing, reconfigure with explicit structure
  const cognitoConfig = config.Auth?.Cognito as { region?: string } | undefined;
  if (!cognitoConfig?.region) {
    // Debug logging (commented out - uncomment for debugging)
    // logger.warn('Region missing after initial configure, reconfiguring with explicit structure');
    
    // Build the complete Auth.Cognito structure with region included
    const loginWith: any = {
      email: true,
      phone: false,
      username: false
    };
    
    // Add OAuth configuration if present
    if (outputs.auth.oauth) {
      loginWith.oauth = {
        domain: outputs.auth.oauth.domain,
        redirectSignIn: outputs.auth.oauth.redirect_sign_in_uri,
        redirectSignOut: outputs.auth.oauth.redirect_sign_out_uri,
        responseType: outputs.auth.oauth.response_type,
        scopes: outputs.auth.oauth.scopes,
        providers: outputs.auth.oauth.identity_providers
      };
    }
    
    // Create complete config structure with Auth.Cognito including region
    const completeConfig: any = {
      Auth: {
        Cognito: {
          userPoolId: outputs.auth.user_pool_id,
          userPoolClientId: outputs.auth.user_pool_client_id,
          identityPoolId: outputs.auth.identity_pool_id,
          region: outputs.auth.aws_region,
          loginWith: loginWith
        }
      }
    };
    
    // CRITICAL: Preserve API config from initial configure or add from outputs
    if (config.API) {
      completeConfig.API = config.API;
    } else if (outputs.data) {
      completeConfig.API = {
        GraphQL: {
          endpoint: outputs.data.url,
          region: outputs.data.aws_region,
          defaultAuthMode: outputs.data.default_authorization_type
        }
      };
    }
    
    // CRITICAL: Preserve Storage config from initial configure or add from outputs
    if (config.Storage) {
      completeConfig.Storage = config.Storage;
    } else if (outputs.storage) {
      completeConfig.Storage = {
        S3: {
          bucket: outputs.storage.bucket_name,
          region: outputs.storage.aws_region,
        }
      };
    }
    
    // Reconfigure with complete structure
    Amplify.configure(completeConfig);
    config = Amplify.getConfig();
    
    // Debug logging (commented out - uncomment for debugging)
    // logger.log('After reconfiguration with explicit structure:', {
    //   hasAuth: !!config.Auth,
    //   hasCognito: !!config.Auth?.Cognito,
    //   hasRegion: !!config.Auth?.Cognito?.region,
    //   regionValue: config.Auth?.Cognito?.region
    // });
  }
  
  // Final verification
  const finalConfig = Amplify.getConfig();
  const finalCognitoConfig = finalConfig?.Auth?.Cognito as { region?: string } | undefined;
  if (!finalCognitoConfig) {
    logger.error('CRITICAL: Auth.Cognito not found after configuration');
    logger.error('Config keys:', Object.keys(finalConfig || {}));
  } else if (!finalCognitoConfig.region) {
    logger.error('CRITICAL: Region still missing after configuration');
    logger.error('Auth.Cognito keys:', Object.keys(finalCognitoConfig));
  } else {
    // Debug logging (commented out - uncomment for debugging)
    // logger.log('✅ Amplify configured successfully');
    // logger.log('✅ Region:', finalConfig.Auth.Cognito.region);
    // logger.log('✅ UserPoolId:', finalConfig.Auth.Cognito.userPoolId);
    // logger.log('✅ OAuth:', !!finalConfig.Auth.Cognito.loginWith?.oauth);
    
    // CRITICAL: Force auth module to initialize by importing it AFTER configuration
    // Use dynamic import in a way that doesn't block but ensures initialization
    import('aws-amplify/auth').then(() => {
      // logger.log('✅ Auth module imported after configuration');
      
      // Verify the config is accessible from the auth module's perspective
      const configAfterAuthImport = Amplify.getConfig();
      const cognitoAfterImport = configAfterAuthImport?.Auth?.Cognito as { region?: string } | undefined;
      if (!cognitoAfterImport?.region) {
        logger.warn('⚠️ Auth module cannot see config after import');
      }
      // else {
      //   logger.log('✅ Auth module can see config, region:', configAfterAuthImport.Auth.Cognito.region);
      // }
    }).catch((importError) => {
      logger.warn('Could not import auth module:', importError);
    });
    
    // Log full config structure for debugging (commented out)
    // logger.log('Full config structure:', {
    //   hasAuth: !!finalConfig.Auth,
    //   hasCognito: !!finalConfig.Auth?.Cognito,
    //   cognitoKeys: finalConfig.Auth?.Cognito ? Object.keys(finalConfig.Auth.Cognito) : [],
    //   hasLoginWith: !!finalConfig.Auth?.Cognito?.loginWith,
    //   hasOAuth: !!finalConfig.Auth?.Cognito?.loginWith?.oauth,
    //   oauthDomain: finalConfig.Auth?.Cognito?.loginWith?.oauth?.domain
    // });
  }
} catch (error) {
  logger.error('Failed to configure Amplify:', error);
  // Don't throw - allow app to continue
  logger.warn('App will continue but authentication may not work');
}

// Export a flag to indicate configuration is complete
export const amplifyConfigured = true;
