const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { auth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

const getStartDateByPeriod = (period = 'daily') => {
  const now = new Date();
  if (period === 'weekly') {
    const d = new Date(now);
    d.setDate(now.getDate() - 7);
    return d;
  }
  if (period === 'monthly') {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
};

router.get('/sales', auth, async (req, res) => {
  try {
    const { period = 'daily' } = req.query;
    const startDate = getStartDateByPeriod(period);

    const [orders, revenue] = await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: startDate }, orderStatus: 'COMPLETED' } }),
      prisma.order.aggregate({
        where: { createdAt: { gte: startDate }, orderStatus: 'COMPLETED' },
        _sum: { totalAmount: true, gstAmount: true, discount: true },
      }),
    ]);

    return res.json({
      success: true,
      data: {
        period,
        orders,
        revenue: revenue._sum.totalAmount || 0,
        gstCollected: revenue._sum.gstAmount || 0,
        discountGiven: revenue._sum.discount || 0,
      },
    });
  } catch (error) {
    console.error('Sales report error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/profit-loss', auth, async (req, res) => {
  try {
    const { period = 'monthly' } = req.query;
    const startDate = getStartDateByPeriod(period);

    const orderItems = await prisma.orderItem.findMany({
      where: { order: { createdAt: { gte: startDate }, orderStatus: 'COMPLETED' } },
      include: { item: { select: { costPrice: true } } },
    });

    const revenue = orderItems.reduce((sum, line) => sum + line.totalAmount, 0);
    const cogs = orderItems.reduce((sum, line) => sum + (line.item.costPrice * line.quantity), 0);
    const profit = revenue - cogs;

    return res.json({
      success: true,
      data: { period, revenue, cogs, profit, marginPercent: revenue > 0 ? (profit / revenue) * 100 : 0 },
    });
  } catch (error) {
    console.error('Profit/loss report error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/dead-stock', auth, async (req, res) => {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    const soldItemIds = await prisma.orderItem.findMany({
      where: { order: { createdAt: { gte: cutoff }, orderStatus: 'COMPLETED' } },
      select: { itemId: true },
      distinct: ['itemId'],
    });
    const soldIds = soldItemIds.map((x) => x.itemId);

    const items = await prisma.item.findMany({
      where: { isActive: true, id: { notIn: soldIds } },
      include: { category: { select: { name: true } } },
      take: 200,
    });

    return res.json({ success: true, data: { daysWithoutSale: 30, items } });
  } catch (error) {
    console.error('Dead stock report error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/high-demand', auth, async (req, res) => {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 7);

    const rows = await prisma.orderItem.groupBy({
      by: ['itemId'],
      where: { order: { createdAt: { gte: since }, orderStatus: 'COMPLETED' } },
      _sum: { quantity: true, totalAmount: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 20,
    });

    const items = await Promise.all(
      rows.map(async (row) => {
        const item = await prisma.item.findUnique({
          where: { id: row.itemId },
          select: { id: true, name: true, quantity: true, minQuantity: true },
        });
        return { item, soldQty: row._sum.quantity || 0, salesValue: row._sum.totalAmount || 0 };
      })
    );

    return res.json({ success: true, data: { since, items } });
  } catch (error) {
    console.error('High demand report error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
