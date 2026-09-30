import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

const root=ReactDOM.createRoot(document.getElementById('root'));
const personal=window.location.pathname.replace(/\/$/,'')==='/personal-analysis';
const view=personal?import('./PersonalAnalysis.jsx'):import('./App.jsx');
view.then(module=>root.render(<React.StrictMode>{React.createElement(module.default)}</React.StrictMode>));
