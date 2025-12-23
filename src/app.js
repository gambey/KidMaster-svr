require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');

const app = express();
const port = process.env.PORT || 3000;

// CORS configuration
const allowedOrigins = process.env.CORS_ORIGIN 
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
  : ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173', 'http://localhost:5174'];

console.log('CORS allowed origins:', allowedOrigins);
console.log('NODE_ENV:', process.env.NODE_ENV || 'development');

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin) {
      console.log('CORS: No origin, allowing request');
      return callback(null, true);
    }
    
    console.log('CORS: Checking origin:', origin);
    
    // In development, allow localhost with any port (more permissive)
    if (process.env.NODE_ENV !== 'production') {
      if (origin.startsWith('http://localhost:') || 
          origin.startsWith('http://127.0.0.1:') ||
          origin.startsWith('http://0.0.0.0:')) {
        console.log('CORS: Development mode, allowing localhost origin:', origin);
        return callback(null, true);
      }
    }
    
    if (allowedOrigins.includes(origin)) {
      console.log('CORS: Origin allowed');
      callback(null, true);
    } else {
      console.warn(`CORS: Blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Type', 'Authorization']
};

// Log all requests for debugging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path} - Origin: ${req.headers.origin || 'none'}`);
  next();
});

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static('public'));
app.use('/auth', authRoutes);

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});

