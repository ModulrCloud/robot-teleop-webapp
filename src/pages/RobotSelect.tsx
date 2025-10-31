import { useState } from "react";
import { useNavigate } from "react-router-dom";
import CardGrid from "../components/CardGrid";
import { type CardGridItemProps } from "../components/CardGridItem";
import "./RobotSelect.css";

const robots: CardGridItemProps[] = [
  { id: 1, title: "Autonomous Rover", description: "Fast and agile", imageUrl: "/rover.webp" },
  { id: 2, title: "UR5", description: "Precise Cobot Control", imageUrl: "/robot_arm.webp" },
  { id: 3, title: "Manual Rover", description: "All terrain", imageUrl: "/rover.webp" },
];

export default function RobotSelect() {
  const [selected, setSelected] = useState<CardGridItemProps[]>([]);
  const hasSelected = selected.length > 0;
  const navigate = useNavigate();

  const handleNext = () => {
    if (hasSelected) {
      navigate('/services');
    }
  };

  return (
    <div className="robot-select-container">
      <h2>Select Robot</h2>
      <CardGrid
        items={robots.map(robot => ({
          ...robot,
        }))}
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
        Next: Services
      </button>
    </div>
  );
}