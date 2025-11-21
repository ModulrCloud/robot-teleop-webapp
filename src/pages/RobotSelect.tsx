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
        
        if (response.errors) {
          setError('Failed to load robots');
          console.error('Error loading robots:', response.errors);
          return;
        }

        // Transform robots from database to CardGridItemProps
        let robotItems: CardGridItemProps[] = (response.data || []).map((robot) => ({
          id: robot.robotId || robot.id, // Use robotId (string) for connection, fallback to id
          title: robot.name,
          description: robot.description,
          imageUrl: getRobotImage(robot.model),
        }));

        // For local development/testing: Add default robot1 if no robots found
        // This allows testing even when user is a Client account
        if (robotItems.length === 0 && (import.meta.env.DEV || import.meta.env.VITE_WS_URL)) {
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
        setError('Failed to load robots');
        console.error('Error loading robots:', err);
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