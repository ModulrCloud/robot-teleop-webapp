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
  const hasSelected = selected.length > 0;
  const navigate = useNavigate();
  
  // Check if user can delete robots (Partners or Admins)
  const canDeleteRobots = user?.group === 'PARTNERS' || user?.group === 'ADMINS';

  useEffect(() => {
    const loadRobots = async () => {
      try {
        setIsLoading(true);
        setError(null);
        // Use Amplify v6 models API to list robots
        const response = await client.models.Robot.list();
        
        // Log the raw response to see what's in the database
        console.log('📊 Raw database response:', {
          hasData: !!response.data,
          dataLength: response.data?.length || 0,
          hasErrors: !!response.errors,
          errorsLength: response.errors?.length || 0,
        });
        
        // Log each robot's actual fields to see what's missing
        if (response.data && response.data.length > 0) {
          console.log('🤖 Robots in database (showing all fields):');
          response.data.forEach((robot: any, index: number) => {
            if (robot === null || robot === undefined) {
              console.log(`  Robot ${index + 1}: ❌ NULL (GraphQL returned null for this item)`);
              return;
            }
            console.log(`  Robot ${index + 1}:`, {
              id: robot.id || '❌ MISSING',
              robotId: robot.robotId || '❌ MISSING',
              name: robot.name || '❌ MISSING',
              description: robot.description || '❌ MISSING',
              model: robot.model || '❌ MISSING',
              partnerId: robot.partnerId || '❌ MISSING',
              createdAt: robot.createdAt || '❌ MISSING',
              updatedAt: robot.updatedAt || '❌ MISSING',
              allFields: robot, // Show all fields
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
        if (response.data && response.data.length > 0) {
          robotItems = (response.data || [])
            .filter((robot) => robot !== null && robot !== undefined) // Filter out null robots
            .map((robot) => ({
              id: robot.robotId || robot.id, // Use robotId (string) for connection, fallback to id
              uuid: robot.id, // Store the actual UUID for deletion
              title: robot.name,
              description: robot.description,
              imageUrl: getRobotImage(robot.model),
            }));
          
          console.log(`✅ Successfully loaded ${robotItems.length} valid robot(s) from database`);
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
            onDelete={canDeleteRobots ? handleDeleteRobot : undefined}
            deletingItemId={deletingRobotId}
          />
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