const express = require('express');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { auth, staffAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Generate invoice number
const generateInvoiceNumber = async () => {
  const prefix = 'INV';
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  // Get today's order count
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const count = await prisma.order.count({
    where: {
      createdAt: {
        gte: today,
        lt: tomorrow
      }
    }
  });
  
  const sequence = String(count + 1).padStart(4, '0');
  return `${prefix}${year}${month}${day}${sequence}`;
};

// @route   GET /api/orders
// @desc    Get all orders with pagination and filtering
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      status,
      paymentStatus,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = {};

    // Search filter (customer name, invoice number)
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { phone: { contains: search, mode: 'insensitive' } } }
      ];
    }

    // Status filter
    if (status) {
      where.orderStatus = status;
    }

    // Payment status filter
    if (paymentStatus) {
      where.paymentStatus = paymentStatus;
    }

    // Date range filter
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        const endDateTime = new Date(endDate);
        endDateTime.setHours(23, 59, 59, 999);
        where.createdAt.lte = endDateTime;
      }
    }

    // Get orders
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          customer: {
            select: { id: true, name: true, phone: true }
          },
          user: {
            select: { id: true, name: true }
          },
          orderItems: {
            include: {
              item: {
                select: { id: true, name: true, barcode: true }
              }
            }
          },
          payments: true
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: parseInt(limit)
      }),
      prisma.order.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        orders,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/orders/:id
// @desc    Get order by ID
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        user: {
          select: { id: true, name: true }
        },
        orderItems: {
          include: {
            item: true
          }
        },
        payments: true
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    res.json({
      success: true,
      data: { order }
    });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/orders
// @desc    Create new order
// @access  Private (Staff+)
router.post('/', [
  staffAuth,
  body('orderItems').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('orderItems.*.itemId').notEmpty().withMessage('Item ID is required'),
  body('orderItems.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be positive'),
  body('paymentMethod').isIn(['CASH', 'UPI', 'CARD', 'CREDIT', 'BANK_TRANSFER']).withMessage('Invalid payment method'),
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

    const { orderItems, customerId, paymentMethod, discount = 0, notes, stockReserved = false } = req.body;

    // Validate items and calculate totals
    let subtotal = 0;
    let totalGst = 0;
    const validatedOrderItems = [];

    for (const orderItem of orderItems) {
      const item = await prisma.item.findUnique({
        where: { id: orderItem.itemId }
      });

      if (!item || !item.isActive) {
        return res.status(400).json({
          success: false,
          message: `Item not found or inactive: ${orderItem.itemId}`
        });
      }

      if (!stockReserved && item.quantity < orderItem.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${item.name}. Available: ${item.quantity}, Requested: ${orderItem.quantity}`
        });
      }

      const itemTotal = item.price * orderItem.quantity;
      const itemGst = itemTotal * (item.gstRate / 100);
      const itemDiscount = orderItem.discount || 0;
      const finalItemTotal = itemTotal - itemDiscount + itemGst;

      subtotal += itemTotal - itemDiscount;
      totalGst += itemGst;

      validatedOrderItems.push({
        itemId: item.id,
        quantity: orderItem.quantity,
        price: item.price,
        discount: itemDiscount,
        gstRate: item.gstRate,
        gstAmount: itemGst,
        totalAmount: finalItemTotal
      });
    }

    // Calculate final totals
    const finalSubtotal = subtotal;
    const finalGstAmount = totalGst;
    const totalAmount = finalSubtotal + finalGstAmount - discount;

    if (totalAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Total amount must be positive'
      });
    }

    // Generate invoice number
    const invoiceNumber = await generateInvoiceNumber();

    // Start transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create order
      const order = await tx.order.create({
        data: {
          invoiceNumber,
          customerId,
          userId: req.user.id,
          subtotal: finalSubtotal,
          discount,
          gstAmount: finalGstAmount,
          totalAmount,
          paymentMethod,
          paymentStatus: paymentMethod === 'CREDIT' ? 'PENDING' : 'PAID',
          orderStatus: 'COMPLETED',
          notes,
        }
      });

      // Create order items and optionally update stock
      for (const orderItem of validatedOrderItems) {
        // Create order item
        await tx.orderItem.create({
          data: {
            orderId: order.id,
            ...orderItem
          }
        });

        if (!stockReserved) {
          // Update item stock only when it was not locked at cart stage
          const item = await tx.item.findUnique({
            where: { id: orderItem.itemId }
          });

          const newQuantity = item.quantity - orderItem.quantity;
          await tx.item.update({
            where: { id: orderItem.itemId },
            data: { quantity: newQuantity }
          });

          // Log inventory change
          await tx.inventoryLog.create({
            data: {
              itemId: orderItem.itemId,
              userId: req.user.id,
              type: 'SALE',
              quantity: orderItem.quantity,
              quantityBefore: item.quantity,
              quantityAfter: newQuantity,
              reason: `Sale - Invoice: ${invoiceNumber}`
            }
          });
        } else {
          // Stock was already reserved by cart operations, keep an explicit sale log.
          await tx.inventoryLog.create({
            data: {
              itemId: orderItem.itemId,
              userId: req.user.id,
              type: 'SALE',
              quantity: orderItem.quantity,
              quantityBefore: 0,
              quantityAfter: 0,
              reason: `Sale confirmed from reserved cart - Invoice: ${invoiceNumber}`
            }
          });
        }
      }

      // Create payment record if not credit
      if (paymentMethod !== 'CREDIT') {
        await tx.payment.create({
          data: {
            orderId: order.id,
            customerId,
            amount: totalAmount,
            paymentMethod,
            paymentType: 'PAYMENT',
            status: 'PAID',
            transactionId: `TXN${Date.now()}`
          }
        });
      }

      return order;
    });

    // Get complete order with relations
    const completeOrder = await prisma.order.findUnique({
      where: { id: result.id },
      include: {
        customer: {
          select: { id: true, name: true, phone: true, email: true }
        },
        user: {
          select: { id: true, name: true }
        },
        orderItems: {
          include: {
            item: {
              select: { id: true, name: true, barcode: true, unit: true }
            }
          }
        },
        payments: true
      }
    });

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: { order: completeOrder }
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/orders/:id
// @desc    Update order (limited updates)
// @access  Private (Staff+)
router.put('/:id', [
  staffAuth,
  body('orderStatus').optional().isIn(['PENDING', 'COMPLETED', 'CANCELLED', 'REFUNDED']).withMessage('Invalid order status'),
  body('paymentStatus').optional().isIn(['PENDING', 'PAID', 'PARTIAL', 'REFUNDED']).withMessage('Invalid payment status'),
  body('notes').optional().isString().withMessage('Notes must be a string'),
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

    // Get current order
    const currentOrder = await prisma.order.findUnique({
      where: { id }
    });

    if (!currentOrder) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Prevent certain updates based on current status
    if (currentOrder.orderStatus === 'COMPLETED' && updateData.orderStatus === 'CANCELLED') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel completed order'
      });
    }

    // Update order
    const order = await prisma.order.update({
      where: { id },
      data: updateData,
      include: {
        customer: {
          select: { id: true, name: true, phone: true }
        },
        orderItems: {
          include: {
            item: {
              select: { id: true, name: true }
            }
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Order updated successfully',
      data: { order }
    });
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/orders/:id/payment
// @desc    Add payment to order
// @access  Private (Staff+)
router.post('/:id/payment', [
  staffAuth,
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be positive'),
  body('paymentMethod').isIn(['CASH', 'UPI', 'CARD', 'BANK_TRANSFER']).withMessage('Invalid payment method'),
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
    const { amount, paymentMethod, notes } = req.body;

    // Get order
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        payments: true
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Calculate total paid
    const totalPaid = order.payments
      .filter(p => p.status === 'PAID')
      .reduce((sum, p) => sum + p.amount, 0);

    const newTotalPaid = totalPaid + amount;

    if (newTotalPaid > order.totalAmount) {
      return res.status(400).json({
        success: false,
        message: 'Payment amount exceeds total order amount'
      });
    }

    // Create payment
    const payment = await prisma.payment.create({
      data: {
        orderId: id,
        customerId: order.customerId,
        amount,
        paymentMethod,
        paymentType: 'PAYMENT',
        status: 'PAID',
        transactionId: `TXN${Date.now()}`,
        notes
      }
    });

    // Update order payment status
    let paymentStatus = 'PARTIAL';
    if (Math.abs(newTotalPaid - order.totalAmount) < 0.01) {
      paymentStatus = 'PAID';
    }

    await prisma.order.update({
      where: { id },
      data: { paymentStatus }
    });

    res.status(201).json({
      success: true,
      message: 'Payment added successfully',
      data: { payment }
    });
  } catch (error) {
    console.error('Add payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/orders/:id/return
// @desc    Process order return
// @access  Private (Staff+)
router.post('/:id/return', [
  staffAuth,
  body('orderItems').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('orderItems.*.orderItemId').notEmpty().withMessage('Order item ID is required'),
  body('orderItems.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be positive'),
  body('reason').optional().isString().withMessage('Reason must be a string'),
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
    const { orderItems, reason } = req.body;

    // Get order
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        orderItems: true
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    let totalRefundAmount = 0;

    // Process return items
    for (const returnItem of orderItems) {
      const orderItem = order.orderItems.find(oi => oi.id === returnItem.orderItemId);
      
      if (!orderItem) {
        return res.status(400).json({
          success: false,
          message: `Order item not found: ${returnItem.orderItemId}`
        });
      }

      if (returnItem.quantity > orderItem.quantity) {
        return res.status(400).json({
          success: false,
          message: `Return quantity exceeds ordered quantity for item: ${orderItem.id}`
        });
      }

      // Calculate refund amount (proportional)
      const refundAmount = (orderItem.totalAmount / orderItem.quantity) * returnItem.quantity;
      totalRefundAmount += refundAmount;

      // Restore stock
      const item = await prisma.item.findUnique({
        where: { id: orderItem.itemId }
      });

      const newQuantity = item.quantity + returnItem.quantity;
      await prisma.item.update({
        where: { id: orderItem.itemId },
        data: { quantity: newQuantity }
      });

      // Log inventory change
      await prisma.inventoryLog.create({
        data: {
          itemId: orderItem.itemId,
          userId: req.user.id,
          type: 'RETURNED',
          quantity: returnItem.quantity,
          quantityBefore: item.quantity,
          quantityAfter: newQuantity,
          reason: `Return - Invoice: ${order.invoiceNumber} - ${reason || 'No reason'}`
        }
      });
    }

    // Create refund payment
    const refundPayment = await prisma.payment.create({
      data: {
        orderId: id,
        customerId: order.customerId,
        amount: totalRefundAmount,
        paymentMethod: order.paymentMethod,
        paymentType: 'REFUND',
        status: 'PAID',
        transactionId: `REF${Date.now()}`,
        notes: reason || 'Order return'
      }
    });

    res.status(201).json({
      success: true,
      message: 'Return processed successfully',
      data: { 
        refundPayment,
        refundAmount: totalRefundAmount
      }
    });
  } catch (error) {
    console.error('Process return error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;
