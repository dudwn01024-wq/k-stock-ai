import React from 'react';
import { createBrowserRouter, replace } from 'react-router-dom';
import App from './App.jsx';

// Stage 1: keep the existing home intact; unregistered client URLs replace to /.
export const publicRoutes = [
  { path: '/', element: <App /> },
  { path: '*', loader: () => replace('/') },
];

export function createPublicRouter() {
  return createBrowserRouter(publicRoutes);
}
