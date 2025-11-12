import { useState } from "react";
import { useNavigate } from "react-router-dom";
import CardGrid from "../components/CardGrid";
import { type CardGridItemProps } from "../components/CardGridItem";
import { usePageTitle } from "../hooks/usePageTitle";
import "./ServiceSelect.css";
import { UnderConstruction } from "../components/UnderConstruction";

const services: CardGridItemProps[] = [
  { id: 1, title: "Lap Time Verification", description: "Modulr", imageUrl: "/stopwatch.png" },
  { id: 2, title: "Local Data Storage", description: "Modulr", imageUrl: "/logo-large.png" },
  { id: 3, title: "S3 Data Storage", description: "AWS", imageUrl: "/amazon-s3.png" },
];

export default function ServiceSelect() {
  usePageTitle();
  const [selected, setSelected] = useState<CardGridItemProps[]>([]);
  const navigate = useNavigate();

  const handleStartSession = () => {
    navigate('/teleop');
  };

  return (
    <div className="service-select-container">
      <UnderConstruction 
        mode="banner" 
        message="Service Selection"
      />
      <h2>Select Services (Optional)</h2>
      <CardGrid
        items={services.map(service => ({
          ...service,
        }))}
        columns={3}
        multiple={true}
        selected={selected}
        setSelected={setSelected}
      />
      <button
        className="start-session-button"
        onClick={handleStartSession}
      >
        Next: Start Session
      </button>
    </div>
  );
}