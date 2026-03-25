import React from 'react';
import ReactDOM from 'react-dom';
import { App } from './App';

// Using legacy ReactDOM.render (React 18 still supports it)
ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root')
);
