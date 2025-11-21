import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import CardGrid from "../components/CardGrid";
import { type CardGridItemProps } from "../components/CardGridItem";
import { usePageTitle } from "../hooks/usePageTitle";
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

export default function RobotSelect() {
  usePageTitle();
  const [selected, setSelected] = useState<CardGridItemProps[]>([]);
  const [robots, setRobots] = useState<CardGridItemProps[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasSelected = selected.length > 0;
  const navigate = useNavigate();

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

        // Transform robots from database to CardGridItemProps
        // Filter out null robots (GraphQL returns null for items with errors)
        // This allows us to show valid robots even if some have errors
        if (response.data && response.data.length > 0) {
          robotItems = (response.data || [])
            .filter((robot) => robot !== null && robot !== undefined) // Filter out null robots
            .map((robot) => ({
              id: robot.robotId || robot.id, // Use robotId (string) for connection, fallback to id
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