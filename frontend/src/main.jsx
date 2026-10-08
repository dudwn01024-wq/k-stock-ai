import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { createPublicRouter } from './router.jsx';
import './index.css';

// Create once outside StrictMode rendering to preserve one router instance.
const router = createPublicRouter();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
