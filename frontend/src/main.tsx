import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import App from './App'
import { ThemeProvider, useTheme } from './lib/theme'
import './index.css'

/** Toaster styled to the palette; re-renders with the resolved theme. */
function ThemedToaster() {
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === 'dark'
  return (
    <Toaster
      position="top-right"
      gutter={8}
      toastOptions={{
        duration: 3500,
        style: {
          background: dark ? '#0f172a' : '#ffffff',
          color: dark ? '#f1f5f9' : '#0f172a',
          border: `1px solid ${dark ? '#1e293b' : '#e2e8f0'}`,
          boxShadow: dark ? '0 8px 24px -8px rgba(0,0,0,0.6)' : '0 8px 24px -8px rgba(15,23,42,0.18)',
          borderRadius: '10px',
          padding: '10px 14px',
          fontSize: '13px',
          fontWeight: 500,
          fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
          maxWidth: '420px',
        },
        success: {
          iconTheme: { primary: '#10b981', secondary: dark ? '#0f172a' : '#ffffff' },
        },
        error: {
          iconTheme: { primary: '#f43f5e', secondary: dark ? '#0f172a' : '#ffffff' },
          duration: 5000,
        },
        loading: {
          iconTheme: { primary: '#6366f1', secondary: dark ? '#0f172a' : '#ffffff' },
        },
      }}
    />
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <App />
        <ThemedToaster />
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
)
