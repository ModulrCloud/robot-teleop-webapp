import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../amplify/data/resource";
import { useState } from "react";
import { useAuthStatus } from "../hooks/useAuthStatus";
import { fetchAuthSession, getCurrentUser } from "@aws-amplify/auth";
import './UserSetup.css';

import outputs from "../../amplify_outputs.json";
import { usePageTitle } from "../hooks/usePageTitle";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleNotch } from "@fortawesome/free-solid-svg-icons";
import { useLocation, useNavigate } from "react-router-dom";

Amplify.configure(outputs);
const client = generateClient<Schema>();

interface PrivateRouteProps {}

export function UserSetup(_props: PrivateRouteProps) {
  usePageTitle();
  const { user } = useAuthStatus();
  const navigate = useNavigate();
  const location = useLocation();
  
  const [userGroup, setUserGroup] = useState<string>("client");

  const [settingGroup, setSettingGroup] = useState<boolean>(false);

  const handleOptionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setUserGroup(event.target.value);
  };
  const onConfirmUserGroup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSettingGroup(true);
    console.log(`Trying to set user group to ${userGroup}!`);
    const resp = await client.queries.setUserGroup({
      group: userGroup,
    }, {
      authMode: "userPool",
    });
    setSettingGroup(false);

    if (resp.data?.statusCode == 200) {
      console.log("Set successfully!");

      // Refresh user groups by getting session again
      await fetchAuthSession({ forceRefresh: true });
      // Redirect to original location or homepage
      const from = location.state?.from || "/";
      navigate(from, { replace: true });
    } else {
      console.log("Errors: ", resp.errors);
      console.log("Response: ", resp.data);
    }
  }

  if (user?.group) {
    return <p>Your user group is {user?.group}.</p>;
  }

  const buttonFormElement = settingGroup ?
    <FontAwesomeIcon icon={faCircleNotch} /> :
    <button type="submit">Confirm Selection</button>
  ;

  return (
    <div className="setup-container">
      <h2>User Configuration</h2>

      <p>You don't have a user group! Let's change that.</p>

      {/* <p>
        <b>Clients</b> can access robots and services, in exchange for tokens.
        If you want to hire services, this is the user group you should select.
      </p>
      <p>
        <b>Partners</b> can provide robots and services in exchange for tokens.
        If you want to make money from providing your hardware or services, this
        is the user group you should select.
      </p> */}

      <form className="group-select" onSubmit={onConfirmUserGroup}>
        <div className="inline">
          <label htmlFor="groupSelect">User group:</label>
          <select id="groupSelect" value={userGroup} onChange={handleOptionChange}>
            <option value="client">Client</option>
            <option value="partner">Partner</option>
          </select>
        </div>
        {buttonFormElement}
      </form>
    </div>
  );
}
