import { useNavigate, useSearchParams } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { TeleopSession } from "../components/TeleopSession";

export default function Teleop() {
  usePageTitle();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const robotId = searchParams.get('robotId') || import.meta.env.VITE_ROBOT_ID || 'robot1';

  return (
    <TeleopSession
      robotId={robotId}
      onEndSession={() => navigate('/robots')}
    />
  );
}
