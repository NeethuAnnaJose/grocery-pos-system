# Grocery Shop Management & POS System

A comprehensive grocery shop management and Point of Sale (POS) system with responsive web support for desktop, tablet, and mobile browsers.

## Tech Stack

### Frontend
- **React (Next.js)** with TypeScript
- **Tailwind CSS** for styling
- **Redux Toolkit** for state management
- **React Query** for server state management

### Backend
- **Node.js** with Express
- **PostgreSQL** database
- **JWT** for authentication
- **Prisma** ORM for database operations

### Key Features

🧾 **Billing & POS**
- GST billing support (India-ready)
- Multiple payment modes (Cash/UPI/Card)
- Quick repeat orders
- Barcode scanner support

📦 **Inventory Management**
- Real-time stock tracking
- Low stock alerts
- Expiry date warnings
- Batch tracking

📊 **Dashboard & Analytics**
- Sales reports (Daily/Weekly/Monthly)
- Top-selling items
- Revenue tracking
- Customer purchase history

🔔 **Smart Alerts**
- Low stock warnings (<5 items)
- Expiry alerts (within 7 days)
- Out-of-stock notifications

🧑‍💼 **Customer Management**
- Customer details storage
- Credit system (udhaar)
- Payment reminders
- Purchase history

🖨️ **Printing Support**
- Thermal printer (80mm receipt)
- A4 invoice printing
- ESC/POS support

📱 **Mobile Support**
- Fully responsive UI for phones/tablets
- Camera barcode scan ready from mobile browser
- Same backend APIs can be used by React Native/Flutter app clients

## Project Structure

```
grocery-pos-system/
├── backend/                 # Node.js Express API
│   ├── src/
│   │   ├── controllers/     # Route controllers
│   │   ├── middleware/      # Express middleware
│   │   ├── models/         # Database models
│   │   ├── routes/         # API routes
│   │   ├── services/       # Business logic
│   │   └── utils/          # Utility functions
│   ├── prisma/             # Database schema
│   └── package.json
├── frontend/               # Next.js React app
│   ├── src/
│   │   ├── components/     # Reusable components
│   │   ├── pages/          # Next.js pages
│   │   ├── store/          # Redux store
│   │   ├── services/       # API services
│   │   └── utils/          # Utility functions
│   └── package.json
└── README.md
```

## Installation & Setup

### Prerequisites
- Node.js (v18 or higher)
- PostgreSQL
- npm or yarn

### Backend Setup

1. Navigate to backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

4. Update `.env` with your database credentials:
```
DATABASE_URL="postgresql://username:password@localhost:5432/grocery_pos"
JWT_SECRET="your-jwt-secret"
```

5. Run database migrations:
```bash
npx prisma migrate dev
```

6. Start the backend server:
```bash
npm run dev
```

### Frontend Setup

1. Navigate to frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env.local
```

4. Update `.env.local` with your API URL:
```
NEXT_PUBLIC_API_URL=http://localhost:5000
```

5. Start the frontend development server:
```bash
npm run dev
```

### Mobile Camera Access (Reliable HTTPS)

If camera scanning does not work on phone browsers, run frontend with an HTTPS tunnel:

```bash
cd frontend
pnpm run dev:tunnel
```

- This command starts Next.js locally and opens a secure `https://*.loca.lt` URL.
- Open that tunnel URL on your phone for scanner usage.
- Keep backend running locally (`backend` server) so `/api/*` rewrites continue to work.

## Default Credentials

After setup, you can login with:
- **Admin**: admin@shop.com / admin123
- **Staff**: staff@shop.com / staff123

## API Documentation

The API documentation will be available at `http://localhost:5000/api-docs` once the backend is running.

## Features in Detail

### Inventory Management
- Add/Edit/Delete grocery items
- Real-time stock tracking
- Barcode support
- Category management
- Expiry date tracking

### POS System
- Fast billing interface
- Cart management
- Dual scan modes: Inventory List scan + Cart Billing scan
- Hardware barcode scanner (keyboard input) support
- Immediate stock reservation when items are added to cart
- Stock release on quantity reduce/remove/clear cart
- Multiple payment methods
- Invoice generation
- Receipt printing
- Product lookup endpoint for barcode scans (`GET /api/product/:barcode`)

### Reports API
- Sales report (`daily`, `weekly`, `monthly`)
- Profit and loss report
- High-demand products (last 7 days)
- Dead stock report (30+ days no sales)

### Dashboard
- Sales analytics
- Revenue tracking
- Low stock alerts
- Expiry warnings
- Customer insights

### User Roles
- **Admin**: Full system access
- **Staff**: Billing and limited inventory access

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License.
