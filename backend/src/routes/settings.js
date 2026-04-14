const express = require('express');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { auth, adminAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// @route   GET /api/settings
// @desc    Get all settings
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const settings = await prisma.settings.findMany({
      orderBy: { key: 'asc' }
    });

    // Convert to key-value object
    const settingsObj = settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});

    res.json({
      success: true,
      data: { settings: settingsObj }
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/settings
// @desc    Update settings
// @access  Private (Admin)
router.put('/', [
  adminAuth,
  body('settings').isArray().withMessage('Settings must be an array'),
  body('settings.*.key').notEmpty().withMessage('Setting key is required'),
  body('settings.*.value').notEmpty().withMessage('Setting value is required'),
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

    const { settings } = req.body;

    // Update each setting
    const updatePromises = settings.map(async (setting) => {
      return prisma.settings.upsert({
        where: { key: setting.key },
        update: { value: setting.value },
        create: {
          key: setting.key,
          value: setting.value
        }
      });
    });

    await Promise.all(updatePromises);

    res.json({
      success: true,
      message: 'Settings updated successfully'
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;
