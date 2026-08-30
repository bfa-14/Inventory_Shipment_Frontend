import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ColorSchemeScript, MantineProvider } from '@mantine/core'
import { ModalsProvider } from '@mantine/modals'
import { Notifications } from '@mantine/notifications'

// Mantine styles first, then mantine-datatable, then the app's own CSS so it can override.
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import '@mantine/dates/styles.css'
import 'mantine-datatable/styles.layer.css'
import './index.css'
import './styles/app.css'

import App from './App.tsx'
import { theme } from './theme'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ColorSchemeScript defaultColorScheme="light" forceColorScheme="light" />
    <MantineProvider theme={theme} defaultColorScheme="light" forceColorScheme="light">
      <Notifications position="top-right" />
      <ModalsProvider>
        <App />
      </ModalsProvider>
    </MantineProvider>
  </StrictMode>,
)
