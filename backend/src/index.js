const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const itemRoutes = require('./routes/items');
const categoryRoutes = require('./routes/categories');
const customerRoutes = require('./routes/customers');
const orderRoutes = require('./routes/orders');
const dashboardRoutes = require('./routes/dashboard');
const alertRoutes = require('./routes/alerts');
const settingsRoutes = require('./routes/settings');
const reportRoutes = require('./routes/reports');
const productRoutes = require('./routes/product');

const errorHandler = require('./middleware/errorHandler');
const { initializeDatabase } = require('./utils/database');

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// CORS: FRONTEND_URL and CORS_EXTRA_ORIGINS may be comma-separated lists (apex + www, staging + prod).
function splitOrigins(value) {
  if (!value || typeof value !== 'string') return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const allowedOrigins = [
  ...splitOrigins(process.env.FRONTEND_URL),
  ...splitOrigins(process.env.CORS_EXTRA_ORIGINS),
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://192.168.0.104:3000',
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (curl/postman) and known origins.
    const isTunnelOrigin =
      typeof origin === 'string' &&
      (origin.endsWith('.loca.lt') || origin.endsWith('.localtunnel.me'));
    const isRenderOrigin =
      typeof origin === 'string' &&
      origin.endsWith('.onrender.com');
    let isVercelPreview = false;
    if (typeof origin === 'string' && process.env.CORS_ALLOW_VERCEL_PREVIEW === 'true') {
      try {
        isVercelPreview = new URL(origin).hostname.endsWith('.vercel.app');
      } catch {
        isVercelPreview = false;
      }
    }

    if (!origin || allowedOrigins.includes(origin) || isTunnelOrigin || isRenderOrigin || isVercelPreview) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use(morgan('combined'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/product', productRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    success: false, 
    message: 'Route not found' 
  });
});

// Error handling middleware
app.use(errorHandler);

// Initialize database and start server
async function startServer() {
  try {
    await initializeDatabase();
    
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Promise Rejection:', err);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  process.exit(1);
});

startServer();

module.exports = app;
