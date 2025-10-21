import { useState } from "react";
import CardGrid from "../components/CardGrid";
import { type CardGridItemProps } from "../components/CardGridItem";
import { Button } from "react-bootstrap";
import "./RobotSelect.css";

const robots: CardGridItemProps[] = [
  { id: 1, title: "Autonomous Rover", description: "Fast and agile", imageUrl: "/rover.webp" },
  { id: 2, title: "UR5", description: "Precise Cobot Control", imageUrl: "/robot_arm.webp" },
  { id: 3, title: "Manual Rover", description: "All terrain", imageUrl: "/rover.webp" },
];

export default function RobotSelect() {
  const [selected, setSelected] = useState<CardGridItemProps[]>([]);
  const hasSelected = selected.length > 0;

  return (
    <div style={{ position: "relative" }}>
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
      <Button
        className="button-yellow"
        id="services-button"
        href="/services"
        style={{
          opacity: hasSelected ? 1 : 0.5,
          pointerEvents: hasSelected ? "auto" : "none",
        }}
        disabled={!hasSelected}
      >
        Next: Services
      </Button>
    </div>
  );
}