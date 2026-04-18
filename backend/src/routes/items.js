const express = require('express');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { auth, staffAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();
const MAX_ITEMS_PAGE_SIZE = 1000;
const ALLOWED_SORT_FIELDS = new Set([
  'name',
  'price',
  'quantity',
  'barcode',
  'createdAt',
  'updatedAt',
  'expiryDate'
]);

const syncStockAndExpiryAlerts = async (item) => {
  const threshold = item.minQuantity || 5;
  const isLowStock = item.quantity <= threshold;
  const hasExpiry = !!item.expiryDate;
  const isExpiringSoon = hasExpiry
    ? (new Date(item.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24) <= 7
    : false;

  const lowStockMessage = `Low stock: ${item.name} has only ${item.quantity} ${item.unit || 'pcs'} left`;
  const expiringMessage = `Expiry warning: ${item.name} expires within 7 days`;

  if (isLowStock) {
    const existingLowStockAlert = await prisma.alert.findFirst({
      where: {
        type: 'LOW_STOCK',
        itemId: item.id,
        isRead: false
      }
    });
    if (!existingLowStockAlert) {
      await prisma.alert.create({
        data: { type: 'LOW_STOCK', itemId: item.id, message: lowStockMessage }
      });
    }
  }

  if (isExpiringSoon) {
    const existingExpiryAlert = await prisma.alert.findFirst({
      where: {
        type: 'EXPIRY',
        itemId: item.id,
        isRead: false
      }
    });
    if (!existingExpiryAlert) {
      await prisma.alert.create({
        data: { type: 'EXPIRY', itemId: item.id, message: expiringMessage }
      });
    }
  }
};

const parsePaginationAndSort = (query) => {
  const parsedPage = Number.parseInt(query.page, 10);
  const parsedLimit = Number.parseInt(query.limit, 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, MAX_ITEMS_PAGE_SIZE)
    : 50;
  const sortBy = ALLOWED_SORT_FIELDS.has(query.sortBy) ? query.sortBy : 'name';
  const sortOrder = String(query.sortOrder || '').toLowerCase() === 'desc' ? 'desc' : 'asc';

  return { page, limit, sortBy, sortOrder };
};

const createSafeOrderBy = (sortBy, sortOrder) => ({ [sortBy]: sortOrder });

// @route   GET /api/items
// @desc    Get all items with pagination and filtering
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const {
      search,
      category,
      lowStock,
      expiring
    } = req.query;
    const { page, limit, sortBy, sortOrder } = parsePaginationAndSort(req.query);

    const skip = (page - 1) * limit;
    const where = { isActive: true };

    // Search filter
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { barcode: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Category filter
    if (category) {
      where.categoryId = category;
    }

    // Low stock filter
    if (lowStock === 'true') {
      where.quantity = { lte: 5 };
    }

    // Expiring filter
    if (expiring === 'true') {
      const sevenDaysFromNow = new Date();
      sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
      where.expiryDate = {
        lte: sevenDaysFromNow,
        gte: new Date()
      };
    }

    // Get items
    const [items, total] = await Promise.all([
      prisma.item.findMany({
        where,
        include: {
          category: {
            select: { id: true, name: true }
          }
        },
        orderBy: createSafeOrderBy(sortBy, sortOrder),
        skip,
        take: limit
      }),
      prisma.item.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        items,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get items error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/items/:id
// @desc    Get item by ID
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const item = await prisma.item.findUnique({
      where: { id: req.params.id },
      include: {
        category: true
      }
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    res.json({
      success: true,
      data: { item }
    });
  } catch (error) {
    console.error('Get item error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/items
// @desc    Create new item
// @access  Private (Staff+)
router.post('/', [
  staffAuth,
  body('name').notEmpty().withMessage('Item name is required'),
  body('categoryId').notEmpty().withMessage('Category is required'),
  body('price').isFloat({ min: 0 }).withMessage('Price must be positive'),
  body('costPrice').isFloat({ min: 0 }).withMessage('Cost price must be positive'),
  body('quantity').isInt({ min: 0 }).withMessage('Quantity must be non-negative'),
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

    const {
      name,
      barcode,
      sku,
      description,
      categoryId,
      price,
      costPrice,
      quantity = 0,
      minQuantity = 5,
      unit = 'pcs',
      hsnCode,
      gstRate = 0,
      expiryDate,
      batchNumber,
      supplier
    } = req.body;

    // Check if barcode or SKU already exists
    if (barcode) {
      const existingBarcode = await prisma.item.findUnique({
        where: { barcode }
      });
      if (existingBarcode) {
        return res.status(400).json({
          success: false,
          message: 'Barcode already exists'
        });
      }
    }

    if (sku) {
      const existingSku = await prisma.item.findUnique({
        where: { sku }
      });
      if (existingSku) {
        return res.status(400).json({
          success: false,
          message: 'SKU already exists'
        });
      }
    }

    // Create item
    const item = await prisma.item.create({
      data: {
        name,
        barcode,
        sku,
        description,
        categoryId,
        price,
        costPrice,
        quantity,
        minQuantity,
        unit,
        hsnCode,
        gstRate,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        batchNumber,
        supplier,
      },
      include: {
        category: true
      }
    });

    await syncStockAndExpiryAlerts(item);

    // Log inventory change
    if (quantity > 0) {
      await prisma.inventoryLog.create({
        data: {
          itemId: item.id,
          userId: req.user.id,
          type: 'STOCK_IN',
          quantity,
          quantityBefore: 0,
          quantityAfter: quantity,
          reason: 'Initial stock'
        }
      });
    }

    res.status(201).json({
      success: true,
      message: 'Item created successfully',
      data: { item }
    });
  } catch (error) {
    console.error('Create item error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/items/:id
// @desc    Update item
// @access  Private (Staff+)
router.put('/:id', [
  staffAuth,
  body('name').optional().notEmpty().withMessage('Item name cannot be empty'),
  body('price').optional().isFloat({ min: 0 }).withMessage('Price must be positive'),
  body('costPrice').optional().isFloat({ min: 0 }).withMessage('Cost price must be positive'),
  body('quantity').optional().isInt({ min: 0 }).withMessage('Quantity must be non-negative'),
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

    // Handle date conversion
    if (updateData.expiryDate) {
      updateData.expiryDate = new Date(updateData.expiryDate);
    }

    // Get current item
    const currentItem = await prisma.item.findUnique({
      where: { id }
    });

    if (!currentItem) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    // Check barcode/SKU uniqueness if being updated
    if (updateData.barcode && updateData.barcode !== currentItem.barcode) {
      const existingBarcode = await prisma.item.findUnique({
        where: { barcode: updateData.barcode }
      });
      if (existingBarcode) {
        return res.status(400).json({
          success: false,
          message: 'Barcode already exists'
        });
      }
    }

    if (updateData.sku && updateData.sku !== currentItem.sku) {
      const existingSku = await prisma.item.findUnique({
        where: { sku: updateData.sku }
      });
      if (existingSku) {
        return res.status(400).json({
          success: false,
          message: 'SKU already exists'
        });
      }
    }

    // Update item
    const item = await prisma.item.update({
      where: { id },
      data: updateData,
      include: {
        category: true
      }
    });

    await syncStockAndExpiryAlerts(item);

    // Log inventory change if quantity updated
    if (updateData.quantity !== undefined && updateData.quantity !== currentItem.quantity) {
      await prisma.inventoryLog.create({
        data: {
          itemId: item.id,
          userId: req.user.id,
          type: updateData.quantity > currentItem.quantity ? 'STOCK_IN' : 'STOCK_OUT',
          quantity: Math.abs(updateData.quantity - currentItem.quantity),
          quantityBefore: currentItem.quantity,
          quantityAfter: updateData.quantity,
          reason: 'Manual adjustment'
        }
      });
    }

    res.json({
      success: true,
      message: 'Item updated successfully',
      data: { item }
    });
  } catch (error) {
    console.error('Update item error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   DELETE /api/items/:id
// @desc    Delete item (soft delete)
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
    const item = await prisma.item.findUnique({
      where: { id: req.params.id }
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    // Soft delete
    await prisma.item.update({
      where: { id: req.params.id },
      data: { isActive: false }
    });

    res.json({
      success: true,
      message: 'Item deleted successfully'
    });
  } catch (error) {
    console.error('Delete item error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/items/:id/stock
// @desc    Update item stock
// @access  Private (Staff+)
router.post('/:id/stock', [
  staffAuth,
  body('quantity').custom((value) => {
    if (value === undefined || value === null || value === '') return false;
    const n = typeof value === 'number' ? value : parseInt(String(value), 10);
    return Number.isInteger(n) && n >= 1;
  }).withMessage('Quantity must be a positive integer'),
  body('type').isIn(['STOCK_IN', 'STOCK_OUT']).withMessage('Invalid stock type'),
  body('reason').optional().notEmpty().withMessage('Reason cannot be empty'),
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
    const { quantity, type, reason = 'Manual adjustment' } = req.body;

    // Get current item
    const item = await prisma.item.findUnique({
      where: { id }
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    // Calculate new quantity
    const quantityBefore = item.quantity;
    let quantityAfter;

    if (type === 'STOCK_IN') {
      quantityAfter = quantityBefore + quantity;
    } else {
      if (quantityBefore < quantity) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient stock for this operation'
        });
      }
      quantityAfter = quantityBefore - quantity;
    }

    // Update item quantity
    const updatedItem = await prisma.item.update({
      where: { id },
      data: { quantity: quantityAfter },
      include: {
        category: true
      }
    });

    await syncStockAndExpiryAlerts(updatedItem);

    // Log inventory change
    await prisma.inventoryLog.create({
      data: {
        itemId: id,
        userId: req.user.id,
        type,
        quantity,
        quantityBefore,
        quantityAfter,
        reason
      }
    });

    res.json({
      success: true,
      message: `Stock ${type.toLowerCase()} successful`,
      data: { item: updatedItem }
    });
  } catch (error) {
    console.error('Stock update error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;
