// Express framework for building the HTTP web server
const express = require('express');
// CORS middleware to enable Cross-Origin Resource Sharing with the React frontend
const cors = require('cors');
// dotenv to load environment variables from a .env file into process.env
const dotenv = require('dotenv');

// Load variables from .env file
dotenv.config();

const app = express();
// Default port set to 5000 as requested, with fallback to environment variable if set
const PORT = process.env.PORT || 5000;

// Allow requests from React frontend application
app.use(cors());
// Parse incoming JSON payloads in request bodies
app.use(express.json());

/**
 * GET /api/health
 * Endpoint used to verify that the backend server is up and responding normally.
 */
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Start the HTTP server listening on the configured port
app.listen(PORT, () => {
  console.log(`[K-Stock AI] Backend server is running on port ${PORT}`);
});
