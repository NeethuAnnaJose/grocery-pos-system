const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { auth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// @route   GET /api/alerts
// @desc    Get all alerts
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 50, unreadOnly = false } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const where = {};
    if (unreadOnly === 'true') {
      where.isRead = false;
    }

    const [alerts, total] = await Promise.all([
      prisma.alert.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.alert.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        alerts,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get alerts error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/alerts/:id/read
// @desc    Mark alert as read
// @access  Private
router.put('/:id/read', auth, async (req, res) => {
  try {
    const alert = await prisma.alert.update({
      where: { id: req.params.id },
      data: { isRead: true }
    });

    res.json({
      success: true,
      message: 'Alert marked as read',
      data: { alert }
    });
  } catch (error) {
    console.error('Mark alert read error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/alerts/read-all
// @desc    Mark all alerts as read
// @access  Private
router.put('/read-all', auth, async (req, res) => {
  try {
    await prisma.alert.updateMany({
      where: { isRead: false },
      data: { isRead: true }
    });

    res.json({
      success: true,
      message: 'All alerts marked as read'
    });
  } catch (error) {
    console.error('Mark all alerts read error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;
