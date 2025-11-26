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

const client = generateClient<Schema>();

// Map robot models to images
const getRobotImage = (model?: string | null): string => {
  switch (model?.toLowerCase()) {
    case 'rover':
      return '/rover.webp';
    case 'humanoid':
      return '/robot_arm.webp';
    case 'drone':
      return '/rover.webp';
    case 'submarine':
      return '/rover.webp';
    default:
      return '/rover.webp';
  }
};

// Extended robot data to include the UUID for deletion
interface RobotData extends CardGridItemProps {
  uuid?: string; // The actual Robot.id (UUID) for deletion
}

export default function RobotSelect() {
  usePageTitle();
  const { user } = useAuthStatus();
  const [selected, setSelected] = useState<CardGridItemProps[]>([]);
  const [robots, setRobots] = useState<RobotData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingRobotId, setDeletingRobotId] = useState<string | null>(null);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const hasSelected = selected.length > 0;
  const navigate = useNavigate();
  
  // Check if user can edit robots (Partners or Admins)
  const canEditRobots = user?.group === 'PARTNERS' || user?.group === 'ADMINS';

  useEffect(() => {
    const loadRobots = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        // Check if the new ACL-filtered query is available (schema needs to be regenerated)
        let response: any;
        if (client.queries.listAccessibleRobotsLambda) {
          console.log('🔍 Using listAccessibleRobotsLambda query');
          try {
            // Use the ACL-filtered query to only get robots the user can access
            const queryResponse = await client.queries.listAccessibleRobotsLambda({
              limit: 50, // Load 50 robots per page
            });
            
            console.log('📥 Raw Lambda response:', {
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
                console.log('📝 Parsing JSON string response...');
                console.log('📝 Raw string (first 200 chars):', queryResponse.data.substring(0, 200));
                const parsed = JSON.parse(queryResponse.data);
                console.log('✅ Parsed successfully:', {
                  hasRobots: !!parsed.robots,
                  robotsType: typeof parsed.robots,
                  robotsIsArray: Array.isArray(parsed.robots),
                  robotsCount: parsed.robots?.length || 0,
                  robotsValue: parsed.robots,
                  hasNextToken: !!parsed.nextToken,
                });
                responseData = parsed;
              } else if (queryResponse.data) {
                console.log('📝 Using response.data directly (not a string)');
                responseData = queryResponse.data as any;
              } else {
                console.warn('⚠️ queryResponse.data is null or undefined');
              }
            } catch (e) {
              console.error('❌ Failed to parse response data:', e);
              console.error('Raw data that failed to parse:', queryResponse.data);
              // Try to extract robots from the raw string as fallback
              if (typeof queryResponse.data === 'string') {
                try {
                  const match = queryResponse.data.match(/"robots":\[(.*?)\]/);
                  if (match) {
                    console.warn('⚠️ Found robots in string but parse failed, trying manual extraction');
                  }
                } catch {}
              }
            }
            
            console.log('📦 Final responseData before setting response:', {
              hasRobots: !!responseData.robots,
              robotsType: typeof responseData.robots,
              robotsIsArray: Array.isArray(responseData.robots),
              robotsCount: responseData.robots?.length || 0,
            });
            
            response = {
              data: responseData,
              errors: queryResponse.errors,
            };
            
            console.log('📦 Final response object:', {
              hasData: !!response.data,
              hasRobots: !!response.data?.robots,
              robotsType: typeof response.data?.robots,
              robotsIsArray: Array.isArray(response.data?.robots),
              robotsCount: response.data?.robots?.length || 0,
            });
          } catch (error) {
            console.error('❌ Error calling listAccessibleRobotsLambda:', error);
            // Fallback to old query on error
            console.warn('⚠️ Falling back to old Robot.list() query due to error');
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
          console.warn('⚠️ listAccessibleRobotsLambda not available yet. Using fallback query. Please restart Amplify sandbox.');
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
        console.log('📊 ACL-filtered robots response:', {
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
          console.warn('⚠️ response.data is still a string! Parsing now...');
          try {
            const parsed = JSON.parse(response.data);
            response.data = parsed;
            console.log('✅ Re-parsed response.data:', {
              hasRobots: !!parsed.robots,
              robotsCount: parsed.robots?.length || 0,
            });
          } catch (e) {
            console.error('❌ Failed to re-parse response.data:', e);
          }
        }
        
        // Log each robot's actual fields
        if (response.data?.robots && response.data.robots.length > 0) {
          console.log(`🤖 Found ${response.data.robots.length} accessible robot(s):`);
          response.data.robots.forEach((robot: any, index: number) => {
            if (robot === null || robot === undefined) {
              console.log(`  Robot ${index + 1}: ❌ NULL`);
              return;
            }
            console.log(`  Robot ${index + 1}:`, {
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
          console.warn('⚠️ Some robots have errors (will be filtered out):', response.errors.length);
          // Log detailed error information for debugging
          response.errors.forEach((err: any, index: number) => {
            console.error(`Error ${index + 1}:`, {
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
          console.warn('⚠️ response.data is still a string, parsing now...');
          try {
            robotsData = JSON.parse(robotsData);
            console.log('✅ Parsed robotsData:', {
              hasRobots: !!robotsData.robots,
              robotsCount: robotsData.robots?.length || 0,
            });
          } catch (e) {
            console.error('❌ Failed to parse robotsData:', e);
            robotsData = { robots: [], nextToken: '' };
          }
        }
        
        const robotsArray = robotsData?.robots && Array.isArray(robotsData.robots) ? robotsData.robots : [];
        
        console.log('🔍 Processing robots array:', {
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
            console.warn('⚠️ User object is empty, trying to fetch from auth session...');
            try {
              const { fetchAuthSession, fetchUserAttributes, getCurrentUser } = await import('aws-amplify/auth');
              const currentUser = await getCurrentUser();
              const attrs = await fetchUserAttributes();
              const session = await fetchAuthSession();
              
              userEmail = attrs.email?.toLowerCase().trim();
              userUsername = currentUser.username?.toLowerCase().trim();
              
              console.log('📥 Fetched user info from auth:', {
                email: userEmail,
                username: userUsername,
                allAttributes: attrs,
                sessionPayload: session.tokens?.idToken?.payload,
              });
            } catch (e) {
              console.error('❌ Failed to fetch user from auth:', e);
            }
          }
          
          console.log('👤 User identifiers for ACL matching:', {
            email: userEmail || '❌ MISSING',
            username: userUsername || '❌ MISSING',
            displayName: user?.displayName || '❌ MISSING',
            group: user?.group || '❌ MISSING',
            isAdmin,
            fullUserObject: user,
          });
          
          console.log(`✅ Found ${robotsArray.length} robots to process`);
          
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
                  console.log(`🔍 ACL check for robot "${robot.name}":`, {
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
              
              return {
                id: (robot.robotId || robot.id) as string, // Use robotId (string) for connection, fallback to id
                uuid: robot.id || undefined, // Store the actual UUID for deletion
                title: robot.name || 'Unnamed Robot',
                description: description,
                location: location, // Location on separate line
                imageUrl: getRobotImage(robot.model),
                disabled: !canAccess, // Gray out if user can't access
              };
            });
          
          console.log(`✅ Successfully loaded ${robotItems.length} valid robot(s) from database`);
          console.log('📋 Robot items details:', robotItems.map(r => ({ id: r.id, title: r.title, disabled: r.disabled })));
          
          // Update pagination state (nextToken is empty string when no more pages)
          const token = response.data.nextToken || '';
          setNextToken(token || null);
          setHasMore(!!token);
        } else {
          console.warn('⚠️ No robots in robotsArray - robotsArray.length is 0');
          console.warn('Response data structure:', {
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
          console.log('No robots found, adding default test robot for dev mode');
          robotItems = [
            {
              id: 'robot1',
              title: 'Test Robot (Local)',
              description: 'Default test robot for local development',
              imageUrl: '/rover.webp',
              uuid: undefined, // No UUID for test robot (can't be deleted)
            },
          ];
        }

        setRobots(robotItems);
      } catch (err) {
        console.error('Exception loading robots:', err);
        // In dev mode, still show default robot even if there's an exception
        if (import.meta.env.DEV || import.meta.env.VITE_WS_URL) {
          console.warn('Exception occurred, but adding default test robot for dev mode');
          setRobots([
            {
              id: 'robot1',
              title: 'Test Robot (Local)',
              description: 'Default test robot for local development',
              imageUrl: '/rover.webp',
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

    loadRobots();
  }, []);

  const handleNext = () => {
    if (hasSelected && selected[0]) {
      const selectedRobot = selected[0];
      // Navigate to services first, then teleop will get robotId from URL
      // Or we could go directly to teleop with robotId in URL
      navigate(`/teleop?robotId=${selectedRobot.id}`);
    }
  };

  const handleEditRobot = (robot: RobotData, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent card selection when clicking edit
    
    if (!robot.uuid) {
      console.error('Cannot edit robot: missing UUID');
      return;
    }
    
    // Navigate to edit page with robot UUID
    navigate(`/edit-robot?robotId=${robot.uuid}`);
  };

  const handleDeleteRobot = async (robot: RobotData, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent card selection when clicking delete
    
    if (!robot.uuid) {
      console.error('Cannot delete robot: missing UUID');
      return;
    }

    const robotName = robot.title;
    if (!confirm(`Are you sure you want to delete "${robotName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      setDeletingRobotId(robot.uuid);
      console.log(`🗑️ Attempting to delete robot: ${robotName} (${robot.uuid})`);
      
      const result = await client.mutations.deleteRobotLambda({ robotId: robot.uuid });
      
      console.log('📊 Delete robot response:', {
        hasData: !!result.data,
        hasErrors: !!result.errors,
        data: result.data,
        errors: result.errors,
      });
      
      // Check for GraphQL errors first
      if (result.errors && result.errors.length > 0) {
        console.error('❌ GraphQL errors:', result.errors);
        const errorMessages = result.errors.map((e: any) => e.message || JSON.stringify(e)).join(', ');
        throw new Error(errorMessages);
      }
      
      // Check the response status
      if (result.data?.statusCode === 200) {
        // Remove the robot from the list
        setRobots(robots.filter(r => r.uuid !== robot.uuid));
        setSelected(selected.filter(s => s.id !== robot.id));
        console.log(`✅ Robot "${robotName}" deleted successfully`);
      } else {
        // Try to parse error message from body
        let errorMessage = 'Failed to delete robot';
        if (result.data?.body) {
          try {
            const errorBody = JSON.parse(result.data.body);
            errorMessage = errorBody.message || errorBody.error || errorMessage;
          } catch {
            errorMessage = result.data.body;
          }
        }
        console.error('❌ Delete failed with status:', result.data?.statusCode, 'body:', result.data?.body);
        throw new Error(errorMessage);
      }
    } catch (error: any) {
      console.error('❌ Exception deleting robot:', {
        error,
        message: error.message,
        errors: error.errors,
        fullError: error,
      });
      
      // Check if it's a "function not found" error (schema not regenerated)
      if (error.message?.includes('is not a function') || error.message?.includes('deleteRobotLambda')) {
        alert('Delete feature not available yet. Please restart your Amplify sandbox to deploy the new delete function.');
      } else {
        // Extract the actual error message - avoid double-wrapping
        let errorMessage = error.message || 'Unknown error';
        
        // Remove redundant "Failed to delete robot:" prefix if it exists
        errorMessage = errorMessage.replace(/^Failed to delete robot:\s*/i, '').trim();
        
        // If we still have a generic message, try to get details from errors array
        if ((errorMessage === 'Failed to delete robot' || errorMessage === 'Unknown error') && error.errors) {
          errorMessage = error.errors[0]?.message || errorMessage;
        }
        
        // Show the actual error message without redundant prefix
        alert(errorMessage || 'Failed to delete robot. Please check the console for details.');
      }
    } finally {
      setDeletingRobotId(null);
    }
  };

  const loadMoreRobots = async () => {
    if (!nextToken || isLoading) return;
    
    try {
      setIsLoading(true);
      
      if (!client.queries.listAccessibleRobotsLambda) {
        console.warn('⚠️ listAccessibleRobotsLambda not available. Cannot load more robots.');
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
        console.error('Failed to parse response data:', e);
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
              imageUrl: getRobotImage(robot.model),
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
      console.error('Error loading more robots:', err);
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
            items={robots}
            columns={3}
            multiple={false}
            selected={selected}
            setSelected={setSelected}
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
      <button
        className="next-services-button"
        onClick={handleNext}
        disabled={!hasSelected}
      >
        Start Session
      </button>
    </div>
  );
}