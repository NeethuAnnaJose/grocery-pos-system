const express = require('express');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { auth, staffAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

const normalizeBarcode = (value) => String(value || '').trim().replace(/\s+/g, '').replace(/-/g, '');

const barcodeCandidates = (value) => {
  const normalized = normalizeBarcode(value);
  if (!normalized) return [];
  const candidates = new Set([normalized, normalized.toUpperCase()]);
  if (/^\d+$/.test(normalized)) {
    const withoutLeadingZeros = normalized.replace(/^0+/, '') || '0';
    candidates.add(withoutLeadingZeros);
    if (normalized.length === 12) candidates.add(`0${normalized}`);
    if (normalized.length === 13 && normalized.startsWith('0')) candidates.add(normalized.slice(1));
  }
  return Array.from(candidates);
};

const ensureDefaultCategory = async () => {
  const existing = await prisma.category.findFirst({
    where: { isActive: true, name: 'General' },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.category.create({
    data: { name: 'General', description: 'Auto-created category for scanned products' },
    select: { id: true },
  });
  return created.id;
};

// GET /api/product/:barcode
router.get('/:barcode', auth, async (req, res) => {
  try {
    const barcode = normalizeBarcode(req.params.barcode);
    if (!barcode) {
      return res.status(400).json({ success: false, message: 'Invalid barcode' });
    }

    const candidates = barcodeCandidates(barcode);
    const items = await prisma.item.findMany({
      where: {
        isActive: true,
        OR: candidates.map((candidate) => ({ barcode: candidate })),
      },
      include: { category: { select: { id: true, name: true } } },
      take: 1,
    });

    if (!items.length) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
        data: { barcode },
      });
    }

    return res.json({
      success: true,
      data: { product: items[0] },
    });
  } catch (error) {
    console.error('Get product by barcode error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/product
// Note: express-validator isFloat/isInt expect strings; JSON clients often send numbers — use custom checks.
router.post(
  '/',
  [
    staffAuth,
    body('name').notEmpty().withMessage('Product name is required'),
    body('barcode').notEmpty().withMessage('Barcode is required'),
    body('price').custom((value) => {
      if (value === undefined || value === null || value === '') return false;
      const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, '.'));
      return Number.isFinite(n) && n >= 0;
    }).withMessage('Price must be a non-negative number'),
    body('quantity').optional().custom((value) => {
      if (value === undefined || value === null || value === '') return true;
      const n = typeof value === 'number' ? value : parseInt(String(value), 10);
      return Number.isInteger(n) && n >= 0;
    }).withMessage('Quantity must be a non-negative integer'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const barcode = normalizeBarcode(req.body.barcode);
      const candidates = barcodeCandidates(barcode);
      const existing = await prisma.item.findFirst({
        where: {
          isActive: true,
          OR: candidates.map((c) => ({ barcode: c })),
        },
        include: { category: { select: { id: true, name: true } } },
      });
      if (existing) {
        return res.status(409).json({
          success: false,
          message: 'Barcode already exists',
          data: { product: existing },
        });
      }

      const categoryId = req.body.categoryId || (await ensureDefaultCategory());
      const price = Number(req.body.price);
      const costPrice = req.body.costPrice !== undefined ? Number(req.body.costPrice) : price;
      const quantity = req.body.quantity !== undefined ? Number(req.body.quantity) : 0;
      const sku = `SKU-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

      const product = await prisma.item.create({
        data: {
          name: String(req.body.name).trim(),
          barcode,
          sku,
          categoryId,
          price,
          costPrice,
          quantity,
          unit: req.body.unit ? String(req.body.unit).trim() : 'pcs',
          expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : null,
        },
        include: { category: { select: { id: true, name: true } } },
      });

      return res.status(201).json({
        success: true,
        message: 'Product created successfully',
        data: { product },
      });
    } catch (error) {
      console.error('Create product error:', error);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

// PUT /api/product/:id
router.put(
  '/:id',
  [
    staffAuth,
    body('name').optional().notEmpty().withMessage('Product name cannot be empty'),
    body('price').optional().isFloat({ min: 0 }).withMessage('Price must be non-negative'),
    body('quantity').optional().isInt({ min: 0 }).withMessage('Quantity must be non-negative'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const id = req.params.id;
      const current = await prisma.item.findUnique({ where: { id } });
      if (!current || !current.isActive) {
        return res.status(404).json({ success: false, message: 'Product not found' });
      }

      const updateData = {};
      if (req.body.name !== undefined) updateData.name = String(req.body.name).trim();
      if (req.body.barcode !== undefined) updateData.barcode = normalizeBarcode(req.body.barcode);
      if (req.body.price !== undefined) updateData.price = Number(req.body.price);
      if (req.body.costPrice !== undefined) updateData.costPrice = Number(req.body.costPrice);
      if (req.body.quantity !== undefined) updateData.quantity = Number(req.body.quantity);
      if (req.body.unit !== undefined) updateData.unit = String(req.body.unit).trim() || 'pcs';
      if (req.body.expiryDate !== undefined) {
        updateData.expiryDate = req.body.expiryDate ? new Date(req.body.expiryDate) : null;
      }

      if (updateData.barcode && updateData.barcode !== current.barcode) {
        const duplicate = await prisma.item.findFirst({
          where: { barcode: updateData.barcode, isActive: true, NOT: { id } },
          select: { id: true },
        });
        if (duplicate) {
          return res.status(400).json({ success: false, message: 'Barcode already exists' });
        }
      }

      const product = await prisma.item.update({
        where: { id },
        data: updateData,
        include: { category: { select: { id: true, name: true } } },
      });

      return res.json({
        success: true,
        message: 'Product updated successfully',
        data: { product },
      });
    } catch (error) {
      console.error('Update product error:', error);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

module.exports = router;
