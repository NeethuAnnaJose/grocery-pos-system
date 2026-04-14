# Grocery POS System - Setup Instructions

## Prerequisites

- Node.js (v18 or higher)
- PostgreSQL (v12 or higher)
- npm or yarn
- Git

## Quick Start

### 1. Clone and Setup

```bash
# Clone the repository
git clone <repository-url>
cd grocery-pos-system

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 2. Database Setup

```bash
# Create PostgreSQL database
createdb grocery_pos

# Go to backend directory
cd backend

# Copy environment file
cp .env.example .env

# Update .env with your database credentials
# DATABASE_URL="postgresql://username:password@localhost:5432/grocery_pos"
# JWT_SECRET="your-super-secret-jwt-key-change-this-in-production"

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev --name init

# Seed the database with sample data
npm run seed
```

### 3. Start the Application

```bash
# Start backend server (in backend directory)
npm run dev

# Start frontend server (in frontend directory)
npm run dev
```

The application will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:5000
- API Health Check: http://localhost:5000/health

## Default Login Credentials

- **Admin**: admin@shop.com / admin123
- **Staff**: staff@shop.com / staff123

## Project Structure

```
grocery-pos-system/
|
+-- backend/                 # Node.js Express API
|   |
|   +-- src/
|   |   |
|   |   +-- controllers/     # Route handlers
|   |   +-- middleware/      # Express middleware
|   |   +-- models/         # Database models (Prisma)
|   |   +-- routes/         # API routes
|   |   +-- services/       # Business logic
|   |   +-- utils/          # Utility functions
|   |   +-- index.js        # App entry point
|   |   +-- seed.js         # Database seeding
|   |
|   +-- prisma/
|   |   +-- schema.prisma   # Database schema
|   |
|   +-- package.json
|   +-- .env.example
|
+-- frontend/               # Next.js React App
    |
    +-- src/
    |   |
    |   +-- pages/          # Next.js pages
    |   +-- components/     # Reusable components
    |   +-- store/          # Redux store
    |   +-- services/       # API services
    |   +-- styles/         # Global styles
    |   +-- types/          # TypeScript types
    |
    +-- package.json
    +-- .env.example
    +-- tailwind.config.js
    +-- tsconfig.json
```

## Features Implemented

### Core Features
- **Authentication**: JWT-based login system with role-based access (Admin/Staff)
- **Inventory Management**: Add/Edit/Delete items, real-time stock tracking
- **POS System**: Fast billing interface with cart management
- **Dashboard**: Sales analytics, low stock alerts, expiring items
- **Customer Management**: Add customers, credit system support
- **Order Management**: Complete order lifecycle with payment tracking

### Advanced Features
- **GST Billing**: India-ready GST billing support
- **Multiple Payment Modes**: Cash, UPI, Card, Credit, Bank Transfer
- **Stock Management**: Automatic stock reduction, low stock alerts
- **Expiry Tracking**: 7-day expiry warnings
- **Invoice Generation**: Professional invoice with QR code support
- **Barcode Support**: Item tracking with barcodes and SKUs
- **Real-time Updates**: Live stock and sales data
- **Responsive Design**: Works on desktop and mobile devices
- **Invoice Printing**: Dedicated invoice page with A4 + Thermal (80mm) print modes
- **Stock Locking**: Cart actions reserve/release stock in real time
- **Reports**: Sales, profit/loss, dead stock, and high-demand endpoints

## API Documentation

### Authentication Endpoints
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `GET /api/auth/me` - Get current user
- `PUT /api/auth/change-password` - Change password

### Inventory Endpoints
- `GET /api/items` - Get all items with pagination
- `POST /api/items` - Create new item
- `PUT /api/items/:id` - Update item
- `DELETE /api/items/:id` - Delete item
- `POST /api/items/:id/stock` - Update stock

### Order Endpoints
- `GET /api/orders` - Get all orders
- `POST /api/orders` - Create new order
- `GET /api/orders/:id` - Get order details
- `POST /api/orders/:id/payment` - Add payment
- `POST /api/orders/:id/return` - Process return

### Dashboard Endpoints
- `GET /api/dashboard/stats` - Get dashboard statistics
- `GET /api/dashboard/recent-sales` - Get recent sales
- `GET /api/dashboard/top-items` - Get top selling items
- `GET /api/dashboard/sales-chart` - Get sales chart data
- `GET /api/dashboard/low-stock` - Get low stock items
- `GET /api/dashboard/expiring` - Get expiring items

### Reports Endpoints
- `GET /api/reports/sales?period=daily|weekly|monthly`
- `GET /api/reports/profit-loss?period=daily|weekly|monthly`
- `GET /api/reports/dead-stock`
- `GET /api/reports/high-demand`

## Database Schema

### Main Tables
- **users**: User accounts with roles
- **items**: Product inventory with stock tracking
- **categories**: Product categories
- **customers**: Customer information with credit limits
- **orders**: Sales orders with payment tracking
- **order_items**: Order line items
- **payments**: Payment records
- **inventory_logs**: Stock change history
- **alerts**: System notifications

## Development

### Running Tests
```bash
# Backend tests
cd backend
npm test

# Frontend tests
cd frontend
npm test
```

### Code Quality
```bash
# Lint backend
cd backend
npm run lint

# Lint frontend
cd frontend
npm run lint
```

### Database Management
```bash
# Create new migration
npx prisma migrate dev --name migration-name

# Reset database
npx prisma migrate reset

# View database
npx prisma studio
```

## Production Deployment

### Backend
1. Set environment variables
2. Build the application: `npm run build`
3. Start with: `npm start`
4. Use PM2 for process management: `pm2 start src/index.js --name grocery-pos-backend`

### Frontend
1. Set environment variables
2. Build the application: `npm run build`
3. Start with: `npm start`
4. Use nginx as reverse proxy for better performance

### Database
1. Use PostgreSQL in production
2. Set up proper backups
3. Configure connection pooling
4. Enable SSL connections

## Security Considerations

- Change JWT secret in production
- Use HTTPS in production
- Implement rate limiting
- Validate all inputs
- Use parameterized queries
- Enable CORS properly
- Set up database security
- Regular security updates

## Troubleshooting

### Common Issues

1. **Database Connection Error**
   - Check PostgreSQL is running
   - Verify DATABASE_URL in .env
   - Ensure database exists

2. **Migration Issues**
   - Drop and recreate database
   - Run `npx prisma migrate reset`
   - Check Prisma schema

3. **Frontend Build Issues**
   - Clear node_modules and reinstall
   - Check TypeScript configuration
   - Verify environment variables

4. **Authentication Issues**
   - Check JWT secret
   - Verify token expiration
   - Clear browser storage

### Performance Optimization

1. **Backend**
   - Use connection pooling
   - Implement caching
   - Optimize database queries
   - Add API rate limiting

2. **Frontend**
   - Use code splitting
   - Optimize images
   - Implement lazy loading
   - Use CDN for assets

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review the API documentation
3. Check the database schema
4. Verify environment configuration

## License

This project is licensed under the MIT License.
