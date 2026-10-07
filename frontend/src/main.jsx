// Starting point of the web app: loads the fonts and styles, then draws <App /> inside the agent context.
// The two font families are installed from npm, so the app looks the same offline.
// This is where the web app starts. It loads the fonts and the shared styles, then draws the App inside the router and the agent context.
import '@fontsource-variable/source-sans-3';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles/tokens.css';
import './styles/global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AgentProvider } from './context/AgentContext.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AgentProvider>
        <App />
      </AgentProvider>
    </BrowserRouter>
  </StrictMode>,
);
