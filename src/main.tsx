// IMPORTANT: Import amplify-config FIRST before any other imports
// This ensures Amplify is configured before any modules that use it are loaded
import './amplify-config'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Authenticator } from '@aws-amplify/ui-react'
import '@aws-amplify/ui-react/styles.css'

import { config } from '@fortawesome/fontawesome-svg-core';
import '@fortawesome/fontawesome-svg-core/styles.css';
config.autoAddCss = false;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Authenticator.Provider>
      <App />
    </Authenticator.Provider>
  </StrictMode>,
)
