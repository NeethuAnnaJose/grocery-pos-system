const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

const initializeDatabase = async () => {
  try {
    // Test database connection
    await prisma.$connect();
    console.log('✅ Database connected successfully');

    // Initialize default settings
    await initializeDefaultSettings();
    
    // Create default admin user if not exists
    await createDefaultAdmin();
    
    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
};

const initializeDefaultSettings = async () => {
  const defaultSettings = [
    { key: 'shop_name', value: process.env.SHOP_NAME || 'Grocery Shop' },
    { key: 'shop_address', value: process.env.SHOP_ADDRESS || '123 Main Street, City, State 123456' },
    { key: 'shop_phone', value: process.env.SHOP_PHONE || '+91 9876543210' },
    { key: 'shop_gstin', value: process.env.SHOP_GSTIN || '27AAAPL1234C1ZV' },
    { key: 'thermal_printer_width', value: process.env.THERMAL_PRINTER_WIDTH || '80' },
    { key: 'low_stock_threshold', value: '5' },
    { key: 'expiry_warning_days', value: '7' },
    { key: 'default_gst_rate', value: '5' },
  ];

  for (const setting of defaultSettings) {
    await prisma.settings.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    });
  }
};

const createDefaultAdmin = async () => {
  const bcrypt = require('bcryptjs');
  
  const existingAdmin = await prisma.user.findFirst({
    where: { role: 'ADMIN' }
  });

  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    
    await prisma.user.create({
      data: {
        email: 'admin@shop.com',
        password: hashedPassword,
        name: 'Admin User',
        role: 'ADMIN',
        phone: '+91 9876543210',
      },
    });
    
    console.log('✅ Default admin user created (admin@shop.com / admin123)');
  }
};

module.exports = {
  prisma,
  initializeDatabase,
};
