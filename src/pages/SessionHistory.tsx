import { usePageTitle } from "../hooks/usePageTitle";
import { UnderConstruction } from "../components/UnderConstruction";

export const SessionHistory = () => {
  usePageTitle();
  
  return (
    <UnderConstruction 
      mode="page" 
      feature="Session History"
      message="We're building a comprehensive session tracking system with detailed analytics and history."
    />
  );
};