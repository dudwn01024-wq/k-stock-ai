import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { createPublicRouter } from './router.jsx';
import './index.css';
import './private-site.css';
import {startPrivateSiteClient} from './privateSiteClient.js';

// Create once outside StrictMode rendering to preserve one router instance.
const router = createPublicRouter();

const tree=(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
const root=document.getElementById('root');
// Hydrate only a matching build-generated guide. SPA fallback stays client rendered.
const path=window.location.pathname.replace(/\/+$/,'')||'/';
startPrivateSiteClient(()=>{
  if(root.dataset.prerendered===path)ReactDOM.hydrateRoot(root,tree);
  else ReactDOM.createRoot(root).render(tree);
});
