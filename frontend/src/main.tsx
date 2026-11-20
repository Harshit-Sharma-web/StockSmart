import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AuthProvider } from './features/auth';
import { App } from './App';
import './styles.css';

const client = new QueryClient({ defaultOptions: { queries: { staleTime: 15000, retry: false } } });
createRoot(document.getElementById('root')!).render(
  <StrictMode><QueryClientProvider client={client}><BrowserRouter><AuthProvider><App /><Toaster position="bottom-right" richColors /></AuthProvider></BrowserRouter></QueryClientProvider></StrictMode>,
);