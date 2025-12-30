import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import CardGrid from "../components/CardGrid";
import { type CardGridItemProps } from "../components/CardGridItem";
import { usePageTitle } from "../hooks/usePageTitle";
import { useAuthStatus } from "../hooks/useAuthStatus";
import { generateClient } from 'aws-amplify/api';
import { Schema } from '../../amplify/data/resource';
import { LoadingWheel } from "../components/LoadingWheel";
import "./RobotSelect.css";
import { getUrl } from 'aws-amplify/storage';
import { logger } from '../utils/logger';
import { formatCreditsAsCurrencySync, fetchExchangeRates } from '../utils/credits';

const client = generateClient<Schema>();

const getRobotImage = (model: string, imageUrl?: string): string => {
  if (imageUrl) return imageUrl;
  
  const modelImages: Record<string, string> = {
    'humanoid': '/humaniod.png',
    'drone': '/drone.png',
    'rover': '/rover.webp',
    'arm': '/robot_arm.webp',
    'submarine': '/submarine.png',
    'racer': '/racer.png',
  };
  
  return modelImages[model.toLowerCase()] || '/humaniod.png';
};

// Extended robot data to include the UUID for deletion
interface RobotData extends CardGridItemProps {
  uuid?: string; // The actual Robot.id (UUID) for deletion
}

export default function RobotSelect() {
  usePageTitle();
  const { user } = useAuthStatus();
  const [selected, setSelected] = useState<CardGridItemProps[]>([]); // Keep for CardGrid compatibility
  const [robots, setRobots] = useState<RobotData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [platformMarkup, setPlatformMarkup] = useState<number>(30); // Default 30%
  const [userCurrency, setUserCurrency] = useState<string>('USD');
  const [exchangeRates, setExchangeRates] = useState<Record<string, number> | null>(null);
  const navigate = useNavigate();
  

  // Load platform markup and user currency preference
  useEffect(() => {
    const loadPlatformSettings = async () => {
      try {
        // Load platform markup
        const { data: settings } = await client.models.PlatformSettings.list({
          filter: { settingKey: { eq: 'platformMarkupPercent' } },
        });
        if (settings && settings.length > 0) {
          const markupValue = parseFloat(settings[0].settingValue || '30');
          setPlatformMarkup(markupValue);
        }

        // Load user's currency preference
        if (user?.username) {
          // Check Partner first, then Client
          const { data: partners } = await client.models.Partner.list({
            filter: { cognitoUsername: { eq: user.username } },
          });
          if (partners && partners.length > 0 && partners[0].preferredCurrency) {
            setUserCurrency(partners[0].preferredCurrency.toUpperCase());
          } else {
            const { data: clients } = await client.models.Client.list({
              filter: { cognitoUsername: { eq: user.username } },
            });
            if (clients && clients.length > 0 && clients[0].preferredCurrency) {
              setUserCurrency(clients[0].preferredCurrency.toUpperCase());
            }
          }
        }

        // Fetch exchange rates
        const rates = await fetchExchangeRates();
        setExchangeRates(rates);
      } catch (err) {
        logger.error("Error loading platform settings:", err);
      }
    };

    loadPlatformSettings();
  }, [user?.username]);

  useEffect(() => {
    const loadRobots = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        // Check if the new ACL-filtered query is available (schema needs to be regenerated)
        let response: any;
        if (client.queries.listAccessibleRobotsLambda) {
          logger.log('🔍 Using listAccessibleRobotsLambda query');
          try {
            // Use the ACL-filtered query to only get robots the user can access
            const queryResponse = await client.queries.listAccessibleRobotsLambda({
              limit: 50, // Load 50 robots per page
            });
            
            logger.log('📥 Raw Lambda response:', {
              hasData: !!queryResponse.data,
              dataType: typeof queryResponse.data,
              dataLength: typeof queryResponse.data === 'string' ? queryResponse.data.length : 'N/A',
              hasErrors: !!queryResponse.errors,
              errors: queryResponse.errors,
            });
            
            // The response.data is a JSON string that needs to be parsed
            let responseData: any = { robots: [], nextToken: '' };
            try {
              if (typeof queryResponse.data === 'string') {
                logger.log('📝 Parsing JSON string response...');
                logger.log('📝 Raw string (first 200 chars):', queryResponse.data.substring(0, 200));
                const parsed = JSON.parse(queryResponse.data);
                logger.log('✅ Parsed successfully:', {
                  hasRobots: !!parsed.robots,
                  robotsType: typeof parsed.robots,
                  robotsIsArray: Array.isArray(parsed.robots),
                  robotsCount: parsed.robots?.length || 0,
                  robotsValue: parsed.robots,
                  hasNextToken: !!parsed.nextToken,
                });
                responseData = parsed;
              } else if (queryResponse.data) {
                logger.log('📝 Using response.data directly (not a string)');
                responseData = queryResponse.data as any;
              } else {
                logger.warn('⚠️ queryResponse.data is null or undefined');
              }
            } catch (e) {
              logger.error('❌ Failed to parse response data:', e);
              logger.error('Raw data that failed to parse:', queryResponse.data);
              // Try to extract robots from the raw string as fallback
              if (typeof queryResponse.data === 'string') {
                try {
                  const match = queryResponse.data.match(/"robots":\[(.*?)\]/);
                  if (match) {
                    logger.warn('⚠️ Found robots in string but parse failed, trying manual extraction');
                  }
                } catch {}
              }
            }
            
            logger.log('📦 Final responseData before setting response:', {
              hasRobots: !!responseData.robots,
              robotsType: typeof responseData.robots,
              robotsIsArray: Array.isArray(responseData.robots),
              robotsCount: responseData.robots?.length || 0,
            });
            
            response = {
              data: responseData,
              errors: queryResponse.errors,
            };
            
            logger.log('📦 Final response object:', {
              hasData: !!response.data,
              hasRobots: !!response.data?.robots,
              robotsType: typeof response.data?.robots,
              robotsIsArray: Array.isArray(response.data?.robots),
              robotsCount: response.data?.robots?.length || 0,
            });
          } catch (error) {
            logger.error('❌ Error calling listAccessibleRobotsLambda:', error);
            // Fallback to old query on error
            logger.warn('⚠️ Falling back to old Robot.list() query due to error');
            const oldResponse = await client.models.Robot.list();
            response = {
              data: {
                robots: oldResponse.data || [],
                nextToken: '',
              },
              errors: oldResponse.errors,
            };
          }
        } else {
          // Fallback: Use the old query (no ACL filtering) until schema is regenerated
          logger.warn('⚠️ listAccessibleRobotsLambda not available yet. Using fallback query. Please restart Amplify sandbox.');
          const oldResponse = await client.models.Robot.list();
          // Transform to match new response format
          response = {
            data: {
              robots: oldResponse.data || [],
              nextToken: '',
            },
            errors: oldResponse.errors,
          };
        }
        
        // Log the raw response to see what's in the database
        logger.log('📊 ACL-filtered robots response:', {
          hasData: !!response.data,
          dataType: typeof response.data,
          dataIsString: typeof response.data === 'string',
          robotsCount: response.data?.robots?.length || 0,
          robotsType: typeof response.data?.robots,
          robotsIsArray: Array.isArray(response.data?.robots),
          nextToken: response.data?.nextToken || null,
          hasErrors: !!response.errors,
          errorsLength: response.errors?.length || 0,
          // If data is still a string, try to parse it here
          dataStringPreview: typeof response.data === 'string' ? response.data.substring(0, 200) : 'N/A',
        });
        
        // If response.data is still a string, parse it now
        if (typeof response.data === 'string') {
          logger.warn('⚠️ response.data is still a string! Parsing now...');
          try {
            const parsed = JSON.parse(response.data);
            response.data = parsed;
            logger.log('✅ Re-parsed response.data:', {
              hasRobots: !!parsed.robots,
              robotsCount: parsed.robots?.length || 0,
            });
          } catch (e) {
            logger.error('❌ Failed to re-parse response.data:', e);
          }
        }
        
        // Log each robot's actual fields
        if (response.data?.robots && response.data.robots.length > 0) {
          logger.log(`🤖 Found ${response.data.robots.length} accessible robot(s):`);
          response.data.robots.forEach((robot: any, index: number) => {
            if (robot === null || robot === undefined) {
              logger.log(`  Robot ${index + 1}: ❌ NULL`);
              return;
            }
            logger.log(`  Robot ${index + 1}:`, {
              id: robot.id || '❌ MISSING',
              robotId: robot.robotId || '❌ MISSING',
              name: robot.name || '❌ MISSING',
              description: robot.description || '❌ MISSING',
              model: robot.model || '❌ MISSING',
              location: robot.city || robot.state || robot.country ? 
                [robot.city, robot.state, robot.country].filter(Boolean).join(', ') : 'Not specified',
              allowedUsers: robot.allowedUsers || [],
            });
          });
        }
        
        let robotItems: CardGridItemProps[] = [];
        
        // Log errors but don't block - we'll still try to use valid robots from response.data
        if (response.errors && response.errors.length > 0) {
          logger.warn('⚠️ Some robots have errors (will be filtered out):', response.errors.length);
          // Log detailed error information for debugging
          response.errors.forEach((err: any, index: number) => {
            logger.error(`Error ${index + 1}:`, {
              message: err.message,
              errorType: err.errorType,
              errorInfo: err.errorInfo,
              path: err.path,
            });
          });
        }

        // Transform robots from database to RobotData (includes UUID for deletion)
        // Filter out null robots (GraphQL returns null for items with errors)
        // This allows us to show valid robots even if some have errors
        
        // Handle case where response.data might still be a string (double-wrapped JSON)
        let robotsData = response.data;
        if (typeof robotsData === 'string') {
          logger.warn('⚠️ response.data is still a string, parsing now...');
          try {
            robotsData = JSON.parse(robotsData);
            logger.log('✅ Parsed robotsData:', {
              hasRobots: !!robotsData.robots,
              robotsCount: robotsData.robots?.length || 0,
            });
          } catch (e) {
            logger.error('❌ Failed to parse robotsData:', e);
            robotsData = { robots: [], nextToken: '' };
          }
        }
        
        const robotsArray = robotsData?.robots && Array.isArray(robotsData.robots) ? robotsData.robots : [];
        
        logger.log('🔍 Processing robots array:', {
          robotsArrayLength: robotsArray.length,
          responseDataRobots: robotsData?.robots,
          isArray: Array.isArray(robotsData?.robots),
          robotsDataType: typeof robotsData,
        });
        
        if (robotsArray.length > 0) {
          // Get user info for ACL checking
          // If user object is missing, try to get it from auth session directly
          let userEmail = user?.email?.toLowerCase().trim();
          let userUsername = user?.username?.toLowerCase().trim();
          const isAdmin = user?.group === 'ADMINS';
          
          // If user object is empty, try to fetch from auth session
          if (!userEmail && !userUsername) {
            logger.warn('⚠️ User object is empty, trying to fetch from auth session...');
            try {
              const { fetchAuthSession, fetchUserAttributes, getCurrentUser } = await import('aws-amplify/auth');
              const currentUser = await getCurrentUser();
              const attrs = await fetchUserAttributes();
              const session = await fetchAuthSession();
              
              userEmail = attrs.email?.toLowerCase().trim();
              userUsername = currentUser.username?.toLowerCase().trim();
              
              logger.log('📥 Fetched user info from auth:', {
                email: userEmail,
                username: userUsername,
                allAttributes: attrs,
                sessionPayload: session.tokens?.idToken?.payload,
              });
            } catch (e) {
              logger.error('❌ Failed to fetch user from auth:', e);
            }
          }
          
          logger.log('👤 User identifiers for ACL matching:', {
            email: userEmail || '❌ MISSING',
            username: userUsername || '❌ MISSING',
            displayName: user?.displayName || '❌ MISSING',
            group: user?.group || '❌ MISSING',
            isAdmin,
            fullUserObject: user,
          });
          
          logger.log(`✅ Found ${robotsArray.length} robots to process`);
          
          robotItems = robotsArray
            .filter((robot: any) => robot !== null && robot !== undefined) // Filter out null robots
            .filter((robot: any) => robot.robotId != null || robot.id != null) // Ensure we have a valid ID
            .map((robot: any) => {
              // Build location string
              const locationParts = [robot.city, robot.state, robot.country].filter(Boolean);
              const location = locationParts.length > 0 ? locationParts.join(', ') : undefined;
              
              // Build description - keep location separate for display on new line
              const description = robot.description || '';
              
              // Check if user can access this robot (for graying out)
              const allowedUsers = robot.allowedUsers || [];
              const hasACL = allowedUsers.length > 0;
              let canAccess = false;
              let accessReason = '';
              
              if (!hasACL) {
                // No ACL = open access
                canAccess = true;
                accessReason = 'No ACL (open access)';
              } else if (isAdmin) {
                // Admins can access all robots
                canAccess = true;
                accessReason = 'Admin user';
              } else {
                // Check if user's email/username is in the ACL
                const normalizedAllowedUsers = allowedUsers.map((email: string) => email.toLowerCase().trim());
                const emailMatch = userEmail && normalizedAllowedUsers.includes(userEmail);
                const usernameMatch = userUsername && normalizedAllowedUsers.includes(userUsername);
                
                canAccess = emailMatch || usernameMatch;
                
                if (canAccess) {
                  accessReason = emailMatch ? `Email match: ${userEmail}` : `Username match: ${userUsername}`;
                } else {
                  accessReason = `Not in ACL. User identifiers: email=${userEmail || 'none'}, username=${userUsername || 'none'}. ACL: ${normalizedAllowedUsers.join(', ')}`;
                }
                
                // Log ACL check details for debugging
                if (robot.name === 'Tugga' || robot.name === 'ACL test') {
                  logger.log(`🔍 ACL check for robot "${robot.name}":`, {
                    robotId: robot.id,
                    hasACL,
                    allowedUsers: normalizedAllowedUsers,
                    userEmail,
                    userUsername,
                    emailMatch,
                    usernameMatch,
                    canAccess,
                    accessReason,
                  });
                }
                
                // TODO: Also check if user is the owner (would need partnerId lookup)
                // For now, we'll rely on the ACL check
              }
              
              // Log model for debugging
              if (robot.model) {
                logger.log(`[ROBOT_IMAGE] Robot "${robot.name || 'Unnamed'}": model="${robot.model}", image="${getRobotImage(robot.model, robot.imageUrl)}"`);
              }
              
              // Calculate hourly rate (partner rate + platform fee)
              let hourlyRateDisplay: string | undefined = undefined;
              
              if (robot.hourlyRateCredits !== null && robot.hourlyRateCredits !== undefined && robot.hourlyRateCredits > 0) {
                // Partner's base rate in credits
                const baseRateCredits = robot.hourlyRateCredits;
                
                // Calculate total rate with platform markup
                // Formula: totalRate = baseRate * (1 + markupPercent / 100)
                const totalRateCredits = baseRateCredits * (1 + platformMarkup / 100);
                
                // Convert to user's currency for display
                const formattedRate = formatCreditsAsCurrencySync(
                  totalRateCredits,
                  userCurrency as any,
                  exchangeRates || undefined
                );
                
                hourlyRateDisplay = `${formattedRate}/hour`;
              } else if (robot.hourlyRateCredits === 0) {
                hourlyRateDisplay = "Free";
              }
              return {
                id: (robot.robotId || robot.id) as string, // Use robotId (string) for connection, fallback to id
                uuid: robot.id || undefined, // Store the actual UUID for deletion
                title: robot.name || 'Unnamed Robot',
                description: description,
                location: location, // Location on separate line
                imageUrl: getRobotImage(robot.model, robot.imageUrl),
                rawImageUrl: robot.imageUrl,
                disabled: !canAccess, // Gray out if user can't access
                hourlyRate: hourlyRateDisplay,
              };
            });
          
          logger.log(`✅ Successfully loaded ${robotItems.length} valid robot(s) from database`);
          logger.log('📋 Robot items details:', robotItems.map(r => ({ id: r.id, title: r.title, disabled: r.disabled })));
          
          // Update pagination state (nextToken is empty string when no more pages)
          const token = response.data.nextToken || '';
          setNextToken(token || null);
          setHasMore(!!token);
        } else {
          logger.warn('⚠️ No robots in robotsArray - robotsArray.length is 0');
          logger.warn('Response data structure:', {
            hasData: !!response.data,
            hasRobots: !!response.data?.robots,
            robotsType: typeof response.data?.robots,
            robotsValue: response.data?.robots,
          });
          setNextToken(null);
          setHasMore(false);
        }

        // For local development/testing: Add default robot1 if no robots found
        // This allows testing even when user is a Client account
        if (robotItems.length === 0 && (import.meta.env.DEV || import.meta.env.VITE_WS_URL)) {
          logger.log('No robots found, adding default test robot for dev mode');
          robotItems = [
            {
              id: 'robot1',
              title: 'Test Robot (Local)',
              description: 'Default test robot for local development',
              imageUrl: '/racer.png',
              uuid: undefined, // No UUID for test robot (can't be deleted)
            },
          ];
        }

        setRobots(robotItems);
        setRawRobotData(robotItems);
      } catch (err) {
        logger.error('Exception loading robots:', err);
        // In dev mode, still show default robot even if there's an exception
        if (import.meta.env.DEV || import.meta.env.VITE_WS_URL) {
          logger.warn('Exception occurred, but adding default test robot for dev mode');
          setRobots([
            {
              id: 'robot1',
              title: 'Test Robot (Local)',
              description: 'Default test robot for local development',
              imageUrl: '/racer.png',
              uuid: undefined, // No UUID for test robot (can't be deleted)
            },
          ]);
        } else {
          setError(`Failed to load robots: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      } finally {
        setIsLoading(false);
      }
    };

    // Only load robots if we have platform settings loaded (or at least defaults)
    // This ensures we can calculate prices correctly
    if (platformMarkup && userCurrency && exchangeRates !== null) {
      loadRobots();
    }
  }, [platformMarkup, userCurrency, exchangeRates]);

  const [resolvedImages, setResolvedImages] = useState<Record<string, string>>({});
  const [rawRobotData, setRawRobotData] = useState<any[]>([]);

  useEffect(() => {
    const resolveImages = async () => {
      const images: Record<string, string> = {};
      for (const robot of rawRobotData) {
        const key = (robot as any).rawImageUrl;
        if (key && !key.startsWith('http') && !key.startsWith('/')) {
          try {
            const result = await getUrl({ path: key });
            images[robot.id] = result.url.toString();
          } catch {
            images[robot.id] = '';
          }
        }
      }
      if (Object.keys(images).length > 0) {
        setResolvedImages(images);
      }
    };
    if (rawRobotData.length > 0) {
      resolveImages();
    }
  }, [rawRobotData]);

  const handleRobotClick = (robot: CardGridItemProps) => {
    // Navigate to robot detail page
    navigate(`/robot/${robot.id}`);
  };

  const handleViewRobot = (robot: RobotData, event: React.MouseEvent) => {
    event.stopPropagation();
    
    if (!robot.uuid) {
      logger.error('Cannot view robot: missing UUID');
      return;
    }
    
    navigate(`/edit-robot?robotId=${robot.uuid}&mode=view`);
  };


  const loadMoreRobots = async () => {
    if (!nextToken || isLoading) return;
    
    try {
      setIsLoading(true);
      
      if (!client.queries.listAccessibleRobotsLambda) {
        logger.warn('⚠️ listAccessibleRobotsLambda not available. Cannot load more robots.');
        setHasMore(false);
        return;
      }
      
      const queryResponse = await client.queries.listAccessibleRobotsLambda({
        limit: 50,
        nextToken: nextToken,
      });
      
      // The response.data is a JSON string that needs to be parsed
      let responseData = { robots: [], nextToken: '' };
      try {
        if (typeof queryResponse.data === 'string') {
          responseData = JSON.parse(queryResponse.data);
        } else if (queryResponse.data) {
          responseData = queryResponse.data as any;
        }
      } catch (e) {
        logger.error('Failed to parse response data:', e);
      }
      const robotsArray = Array.isArray(responseData.robots) ? responseData.robots : [];
      if (robotsArray.length > 0) {
        const newRobotItems = robotsArray
          .filter((robot: any) => robot !== null && robot !== undefined)
          .filter((robot: any) => robot.robotId != null || robot.id != null)
          .map((robot: any) => {
            const locationParts = [robot.city, robot.state, robot.country].filter(Boolean);
            const location = locationParts.length > 0 ? locationParts.join(', ') : undefined;
            let description = robot.description || '';
            if (location) {
              description = description ? `${description} • ${location}` : location;
            }
            
            return {
              id: (robot.robotId || robot.id) as string,
              uuid: robot.id || undefined,
              title: robot.name || 'Unnamed Robot',
              description: description,
              imageUrl: resolvedImages[robot.id] || getRobotImage(robot.model, robot.imageUrl),
            };
          });
        
        setRobots(prev => [...prev, ...newRobotItems]);
        const token = responseData.nextToken || '';
        setNextToken(token || null);
        setHasMore(!!token);
      } else {
        setNextToken(null);
        setHasMore(false);
      }
    } catch (err) {
      logger.error('Error loading more robots:', err);
      alert('Failed to load more robots. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="robot-select-container">
        <h2>Select Robot</h2>
        <LoadingWheel />
      </div>
    );
  }

  if (error) {
    return (
      <div className="robot-select-container">
        <h2>Select Robot</h2>
        <p className="error-message">{error}</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  // Only show empty state if we're not in dev mode (where we add default robot1)
  if (robots.length === 0 && !(import.meta.env.DEV || import.meta.env.VITE_WS_URL)) {
    return (
      <div className="robot-select-container">
        <h2>Select Robot</h2>
        <p>No robots available. Partners can create robot listings.</p>
      </div>
    );
  }

  return (
    <div className="robot-select-container">
      <h2>Select Robot</h2>
          <CardGrid
            items={robots.map(robot => ({ ...robot, imageUrl: resolvedImages[robot.id] || robot.imageUrl }))}
            columns={3}
            multiple={false}
            selected={selected}
            setSelected={setSelected}
            onItemClick={handleRobotClick}
            onView={handleViewRobot}
            onEdit={canEditRobots ? handleEditRobot : undefined}
            onDelete={canEditRobots ? handleDeleteRobot : undefined}
            deletingItemId={deletingRobotId}
          />
      {hasMore && (
        <button
          className="load-more-button"
          onClick={loadMoreRobots}
          disabled={isLoading}
          style={{
            marginTop: '1rem',
            padding: '0.75rem 1.5rem',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: '8px',
            color: '#fff',
            cursor: isLoading ? 'wait' : 'pointer',
            fontSize: '1rem',
          }}
        >
          {isLoading ? 'Loading...' : 'Load More Robots'}
        </button>
      )}
    </div>
  );
}