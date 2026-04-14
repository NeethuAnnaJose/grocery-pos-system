const express = require('express');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { auth, staffAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// @route   GET /api/categories
// @desc    Get all categories
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      include: {
        _count: {
          select: { items: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    res.json({
      success: true,
      data: { categories }
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/categories/:id
// @desc    Get category by ID
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const category = await prisma.category.findUnique({
      where: { id: req.params.id },
      include: {
        items: {
          where: { isActive: true },
          select: { id: true, name: true, quantity: true, price: true }
        }
      }
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    res.json({
      success: true,
      data: { category }
    });
  } catch (error) {
    console.error('Get category error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/categories
// @desc    Create new category
// @access  Private (Staff+)
router.post('/', [
  staffAuth,
  body('name').notEmpty().withMessage('Category name is required'),
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

    const { name, description } = req.body;

    // Check if category already exists
    const existingCategory = await prisma.category.findUnique({
      where: { name }
    });

    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message: 'Category with this name already exists'
      });
    }

    const category = await prisma.category.create({
      data: {
        name,
        description,
      }
    });

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: { category }
    });
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/categories/:id
// @desc    Update category
// @access  Private (Staff+)
router.put('/:id', [
  staffAuth,
  body('name').optional().notEmpty().withMessage('Category name cannot be empty'),
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

    // Get current category
    const currentCategory = await prisma.category.findUnique({
      where: { id }
    });

    if (!currentCategory) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Check name uniqueness if being updated
    if (updateData.name && updateData.name !== currentCategory.name) {
      const existingCategory = await prisma.category.findUnique({
        where: { name: updateData.name }
      });
      if (existingCategory) {
        return res.status(400).json({
          success: false,
          message: 'Category with this name already exists'
        });
      }
    }

    const category = await prisma.category.update({
      where: { id },
      data: updateData
    });

    res.json({
      success: true,
      message: 'Category updated successfully',
      data: { category }
    });
  } catch (error) {
    console.error('Update category error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   DELETE /api/categories/:id
// @desc    Delete category (soft delete)
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
    const category = await prisma.category.findUnique({
      where: { id: req.params.id },
      include: {
        _count: {
          select: { items: true }
        }
      }
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    if (category._count.items > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete category with existing items'
      });
    }

    // Soft delete
    await prisma.category.update({
      where: { id: req.params.id },
      data: { isActive: false }
    });

    res.json({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;
