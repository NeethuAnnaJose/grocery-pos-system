const express = require('express');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { auth, staffAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// @route   GET /api/customers
// @desc    Get all customers with pagination and filtering
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      search,
      sortBy = 'name',
      sortOrder = 'asc'
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = { isActive: true };

    // Search filter
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Get customers
    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        include: {
          _count: {
            select: { orders: true }
          }
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: parseInt(limit)
      }),
      prisma.customer.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        customers,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/customers/:id
// @desc    Get customer by ID
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            invoiceNumber: true,
            totalAmount: true,
            paymentStatus: true,
            orderStatus: true,
            createdAt: true
          }
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            amount: true,
            paymentMethod: true,
            paymentType: true,
            status: true,
            createdAt: true
          }
        }
      }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    res.json({
      success: true,
      data: { customer }
    });
  } catch (error) {
    console.error('Get customer error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/customers
// @desc    Create new customer
// @access  Private (Staff+)
router.post('/', [
  staffAuth,
  body('name').notEmpty().withMessage('Customer name is required'),
  body('phone').notEmpty().withMessage('Phone number is required'),
  body('email').optional().isEmail().withMessage('Please provide a valid email'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { name, phone, email, address, creditLimit = 0 } = req.body;

    // Check if phone already exists
    const existingPhone = await prisma.customer.findUnique({
      where: { phone }
    });

    if (existingPhone) {
      return res.status(400).json({
        success: false,
        message: 'Customer with this phone number already exists'
      });
    }

    // Check if email already exists
    if (email) {
      const existingEmail = await prisma.customer.findUnique({
        where: { email }
      });
      if (existingEmail) {
        return res.status(400).json({
          success: false,
          message: 'Customer with this email already exists'
        });
      }
    }

    const customer = await prisma.customer.create({
      data: {
        name,
        phone,
        email,
        address,
        creditLimit,
      }
    });

    res.status(201).json({
      success: true,
      message: 'Customer created successfully',
      data: { customer }
    });
  } catch (error) {
    console.error('Create customer error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/customers/:id
// @desc    Update customer
// @access  Private (Staff+)
router.put('/:id', [
  staffAuth,
  body('name').optional().notEmpty().withMessage('Customer name cannot be empty'),
  body('phone').optional().notEmpty().withMessage('Phone number cannot be empty'),
  body('email').optional().isEmail().withMessage('Please provide a valid email'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const updateData = req.body;

    // Get current customer
    const currentCustomer = await prisma.customer.findUnique({
      where: { id }
    });

    if (!currentCustomer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Check phone uniqueness if being updated
    if (updateData.phone && updateData.phone !== currentCustomer.phone) {
      const existingPhone = await prisma.customer.findUnique({
        where: { phone: updateData.phone }
      });
      if (existingPhone) {
        return res.status(400).json({
          success: false,
          message: 'Phone number already exists'
        });
      }
    }

    // Check email uniqueness if being updated
    if (updateData.email && updateData.email !== currentCustomer.email) {
      const existingEmail = await prisma.customer.findUnique({
        where: { email: updateData.email }
      });
      if (existingEmail) {
        return res.status(400).json({
          success: false,
          message: 'Email already exists'
        });
      }
    }

    const customer = await prisma.customer.update({
      where: { id },
      data: updateData
    });

    res.json({
      success: true,
      message: 'Customer updated successfully',
      data: { customer }
    });
  } catch (error) {
    console.error('Update customer error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   DELETE /api/customers/:id
// @desc    Delete customer (soft delete)
// @access  Private (Admin)
router.delete('/:id', [auth, async (req, res, next) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin rights required.'
    });
  }
  next();
}], async (req, res) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
        _count: {
          select: { orders: true }
        }
      }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    if (customer._count.orders > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete customer with existing orders'
      });
    }

    // Soft delete
    await prisma.customer.update({
      where: { id: req.params.id },
      data: { isActive: false }
    });

    res.json({
      success: true,
      message: 'Customer deleted successfully'
    });
  } catch (error) {
    console.error('Delete customer error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/customers/:id/balance
// @desc    Get customer balance and credit information
// @access  Private
router.get('/:id/balance', auth, async (req, res) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
        orders: {
          where: { paymentMethod: 'CREDIT' },
          include: {
            payments: true
          }
        }
      }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Calculate current balance
    let totalCredit = 0;
    let totalPaid = 0;

    for (const order of customer.orders) {
      totalCredit += order.totalAmount;
      totalPaid += order.payments
        .filter(p => p.status === 'PAID' && p.paymentType === 'CREDIT_PAYMENT')
        .reduce((sum, p) => sum + p.amount, 0);
    }

    const currentBalance = totalCredit - totalPaid;
    const availableCredit = customer.creditLimit - currentBalance;

    res.json({
      success: true,
      data: {
        creditLimit: customer.creditLimit,
        currentBalance,
        availableCredit,
        totalCredit,
        totalPaid
      }
    });
  } catch (error) {
    console.error('Get customer balance error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;
