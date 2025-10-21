import { useState } from "react";
import CardGrid from "../components/CardGrid";
import { type CardGridItemProps } from "../components/CardGridItem";
import { Button } from "react-bootstrap";
import "./ServiceSelect.css";

const services: CardGridItemProps[] = [
  { id: 1, title: "Lap Time Verification", description: "Modulr", imageUrl: "/stopwatch.png" },
  { id: 2, title: "Local Data Storage", description: "Modulr", imageUrl: "/logo-large.png" },
  { id: 3, title: "S3 Data Storage", description: "AWS", imageUrl: "/amazon-s3.png" },
];

export default function ServiceSelect() {
  const [selected, setSelected] = useState<CardGridItemProps[]>([]);

  return (
    <div style={{ position: "relative" }}>
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
      <Button
        className="button-yellow"
        id="session-button"
        href="/teleop"
      >
        Next: Start Session
      </Button>
    </div>
  );
}