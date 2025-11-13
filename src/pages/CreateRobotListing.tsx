import { useState } from 'react';
import './CreateRobotListing.css';
import { generateClient } from 'aws-amplify/api';
import { Schema } from '../../amplify/data/resource';
import { LoadingWheel } from '../components/LoadingWheel';
import { Amplify } from 'aws-amplify';
import outputs from '../../amplify_outputs.json';
import { usePageTitle } from "../hooks/usePageTitle";

const ROBOT_MODELS = [
  "Rover",
  "Humanoid",
  "Drone",
  "Submarine",
];

type RobotListing = {
  robotName: string,
  description: string,
  model: string,
};

Amplify.configure(outputs);
const client = generateClient<Schema>();

export const CreateRobotListing = () => {
  usePageTitle();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [success, setSuccess] = useState<boolean | undefined>();

  const [robotListing, setRobotListing] = useState<RobotListing>({
    robotName: "",
    description: "",
    model: ROBOT_MODELS[0],
  });

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;

    setRobotListing((prevRobotListing) => ({
      ...prevRobotListing,
      [name]: value,
    }));
  }

  const onConfirmCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);

    console.log(`Trying to create new robot listing!`);
    const robot = await client.mutations.setRobotLambda({
      ...robotListing
    });
    console.log("Result:", robot);

    if (robot.errors) {
      console.error("Error:", robot.errors);
      setSuccess(false);
    } else {
      setSuccess(true);
    }

    setIsLoading(false);
  }

  let userFeedback = null;
  if (isLoading) {
    userFeedback = <LoadingWheel />
  } else {
    if (success === true) {
      userFeedback = <p className="success">Success! Your robot listing has been created.</p>;
    } else if (success === false) {
      userFeedback = <p className="error">Something went wrong! Please try again in a few minutes.</p>;
    }
  }

  return (
    <div className="create-robot-listing-container">
      <h2>List a Robot for Teleoperation</h2>

      {/* TODO(michael): Make this prettier */}

      <p>List a robot using the form below. This will allow clients to teleoperate the robot.</p>

      <form className="create-robot-listing-form" onSubmit={onConfirmCreate}>

        <div className="inline">
          <label htmlFor="robot-name">Robot Name:</label>
          <input id="robot-name" type="text" name='robotName' onChange={handleInputChange}></input>
        </div>

        <div className="inline">
          <label htmlFor="robot-model">Robot Model:</label>
          <select id="robot-model" name='model' value={robotListing.model.toLowerCase()} onChange={handleInputChange}>
            {ROBOT_MODELS.map(model => <option key={model} value={model.toLowerCase()}>{model}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="robot-description">Robot Description (optional):</label>
          <textarea name='description' onChange={handleInputChange}></textarea>
        </div>
        <button type="submit">Confirm Robot Listing</button>
      </form>

      {userFeedback}

    </div>
  );
}
