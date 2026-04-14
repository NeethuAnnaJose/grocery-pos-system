const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seeding...');

  // Create default categories
  const categories = [
    { name: 'Fruits & Vegetables', description: 'Fresh fruits and vegetables' },
    { name: 'Dairy & Eggs', description: 'Milk, cheese, eggs, and other dairy products' },
    { name: 'Bakery', description: 'Bread, cakes, and other baked goods' },
    { name: 'Meat & Fish', description: 'Fresh meat and seafood' },
    { name: 'Beverages', description: 'Soft drinks, juices, and other beverages' },
    { name: 'Snacks', description: 'Chips, cookies, and other snacks' },
    { name: 'Grains & Cereals', description: 'Rice, wheat, and other grains' },
    { name: 'Spices & Condiments', description: 'Spices, sauces, and condiments' },
    { name: 'Personal Care', description: 'Soaps, shampoos, and personal care items' },
    { name: 'Household', description: 'Cleaning supplies and household items' },
  ];

  for (const category of categories) {
    await prisma.category.upsert({
      where: { name: category.name },
      update: {},
      create: category,
    });
  }

  // Get category IDs first
  const categoryRecords = await prisma.category.findMany();
  const categoryMap = {};
  categoryRecords.forEach(cat => {
    categoryMap[cat.name] = cat.id;
  });

  // Create sample items
  const items = [
    // Fruits & Vegetables
    { name: 'Apple', categoryId: categoryMap['Fruits & Vegetables'], price: 80, costPrice: 60, quantity: 50, unit: 'kg', gstRate: 0 },
    { name: 'Banana', categoryId: categoryMap['Fruits & Vegetables'], price: 60, costPrice: 45, quantity: 30, unit: 'dozen', gstRate: 0 },
    { name: 'Tomato', categoryId: categoryMap['Fruits & Vegetables'], price: 40, costPrice: 30, quantity: 25, unit: 'kg', gstRate: 0 },
    { name: 'Onion', categoryId: categoryMap['Fruits & Vegetables'], price: 35, costPrice: 25, quantity: 40, unit: 'kg', gstRate: 0 },
    { name: 'Potato', categoryId: categoryMap['Fruits & Vegetables'], price: 30, costPrice: 20, quantity: 60, unit: 'kg', gstRate: 0 },
    
    // Dairy & Eggs
    { name: 'Milk', categoryId: categoryMap['Dairy & Eggs'], price: 55, costPrice: 45, quantity: 20, unit: 'liter', gstRate: 5 },
    { name: 'Eggs', categoryId: categoryMap['Dairy & Eggs'], price: 6, costPrice: 5, quantity: 100, unit: 'piece', gstRate: 5 },
    { name: 'Cheese', categoryId: categoryMap['Dairy & Eggs'], price: 250, costPrice: 200, quantity: 15, unit: 'kg', gstRate: 5 },
    { name: 'Butter', categoryId: categoryMap['Dairy & Eggs'], price: 180, costPrice: 150, quantity: 10, unit: 'kg', gstRate: 5 },
    
    // Bakery
    { name: 'Bread', categoryId: categoryMap['Bakery'], price: 40, costPrice: 30, quantity: 25, unit: 'loaf', gstRate: 5 },
    { name: 'Cake', categoryId: categoryMap['Bakery'], price: 350, costPrice: 250, quantity: 5, unit: 'kg', gstRate: 5 },
    { name: 'Biscuits', categoryId: categoryMap['Bakery'], price: 25, costPrice: 20, quantity: 40, unit: 'packet', gstRate: 5 },
    
    // Beverages
    { name: 'Coca Cola', categoryId: categoryMap['Beverages'], price: 45, costPrice: 35, quantity: 30, unit: 'bottle', gstRate: 18 },
    { name: 'Orange Juice', categoryId: categoryMap['Beverages'], price: 80, costPrice: 60, quantity: 15, unit: 'liter', gstRate: 12 },
    { name: 'Mineral Water', categoryId: categoryMap['Beverages'], price: 20, costPrice: 15, quantity: 50, unit: 'bottle', gstRate: 18 },
    
    // Snacks
    { name: 'Potato Chips', categoryId: categoryMap['Snacks'], price: 30, costPrice: 20, quantity: 35, unit: 'packet', gstRate: 18 },
    { name: 'Chocolate', categoryId: categoryMap['Snacks'], price: 50, costPrice: 35, quantity: 20, unit: 'bar', gstRate: 18 },
    { name: 'Cookies', categoryId: categoryMap['Snacks'], price: 40, costPrice: 30, quantity: 25, unit: 'packet', gstRate: 18 },
  ];

  for (const item of items) {
    const barcode = `BC${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    const sku = `SKU${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    
    await prisma.item.upsert({
      where: { sku },
      update: {},
      create: {
        ...item,
        barcode,
        sku,
        minQuantity: 5,
      },
    });
  }

  // Create sample customers
  const customers = [
    { name: 'John Doe', phone: '9876543210', email: 'john@example.com', creditLimit: 5000 },
    { name: 'Jane Smith', phone: '9876543211', email: 'jane@example.com', creditLimit: 3000 },
    { name: 'Bob Johnson', phone: '9876543212', creditLimit: 2000 },
    { name: 'Alice Brown', phone: '9876543213', email: 'alice@example.com', creditLimit: 4000 },
    { name: 'Charlie Wilson', phone: '9876543214', creditLimit: 1000 },
  ];

  for (const customer of customers) {
    await prisma.customer.upsert({
      where: { phone: customer.phone },
      update: {},
      create: customer,
    });
  }

  // Create staff user
  const hashedPassword = await bcrypt.hash('staff123', 10);
  await prisma.user.upsert({
    where: { email: 'staff@shop.com' },
    update: {},
    create: {
      email: 'staff@shop.com',
      password: hashedPassword,
      name: 'Staff User',
      role: 'STAFF',
      phone: '9876543215',
    },
  });

  console.log('Database seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
