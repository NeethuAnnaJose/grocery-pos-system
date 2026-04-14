const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { auth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// @route   GET /api/dashboard/stats
// @desc    Get dashboard statistics
// @access  Private
router.get('/stats', auth, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);

    // Get today's stats
    const [
      todaySales,
      todayRevenue,
      todayOrders,
      todayCustomers
    ] = await Promise.all([
      prisma.order.count({
        where: {
          createdAt: { gte: today, lt: tomorrow },
          orderStatus: 'COMPLETED'
        }
      }),
      prisma.order.aggregate({
        where: {
          createdAt: { gte: today, lt: tomorrow },
          orderStatus: 'COMPLETED'
        },
        _sum: { totalAmount: true }
      }),
      prisma.order.count({
        where: {
          createdAt: { gte: today, lt: tomorrow }
        }
      }),
      prisma.order.groupBy({
        by: ['customerId'],
        where: {
          createdAt: { gte: today, lt: tomorrow },
          customerId: { not: null }
        }
      })
    ]);

    // Get this month's stats
    const [
      monthSales,
      monthRevenue,
      monthOrders
    ] = await Promise.all([
      prisma.order.count({
        where: {
          createdAt: { gte: thisMonth },
          orderStatus: 'COMPLETED'
        }
      }),
      prisma.order.aggregate({
        where: {
          createdAt: { gte: thisMonth },
          orderStatus: 'COMPLETED'
        },
        _sum: { totalAmount: true }
      }),
      prisma.order.count({
        where: {
          createdAt: { gte: thisMonth }
        }
      })
    ]);

    // Get last month's stats for comparison
    const [
      lastMonthRevenue,
      lastMonthSales
    ] = await Promise.all([
      prisma.order.aggregate({
        where: {
          createdAt: { gte: lastMonth, lte: lastMonthEnd },
          orderStatus: 'COMPLETED'
        },
        _sum: { totalAmount: true }
      }),
      prisma.order.count({
        where: {
          createdAt: { gte: lastMonth, lte: lastMonthEnd },
          orderStatus: 'COMPLETED'
        }
      })
    ]);

    // Calculate growth percentages
    const revenueGrowth = lastMonthRevenue._sum.totalAmount 
      ? ((monthRevenue._sum.totalAmount - lastMonthRevenue._sum.totalAmount) / lastMonthRevenue._sum.totalAmount) * 100
      : 0;

    const salesGrowth = lastMonthSales
      ? ((monthSales - lastMonthSales) / lastMonthSales) * 100
      : 0;

    // Get inventory stats
    const [
      totalItems,
      lowStockItems,
      outOfStockItems,
      expiringItems
    ] = await Promise.all([
      prisma.item.count({
        where: { isActive: true }
      }),
      prisma.item.count({
        where: {
          isActive: true,
          quantity: { lte: 5, gt: 0 }
        }
      }),
      prisma.item.count({
        where: {
          isActive: true,
          quantity: 0
        }
      }),
      prisma.item.count({
        where: {
          isActive: true,
          expiryDate: {
            lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            gte: new Date()
          }
        }
      })
    ]);

    // Get customer stats
    const [totalCustomers, activeCustomers] = await Promise.all([
      prisma.customer.count({
        where: { isActive: true }
      }),
      prisma.customer.count({
        where: {
          isActive: true,
          orders: {
            some: {
              createdAt: { gte: thisMonth }
            }
          }
        }
      })
    ]);

    res.json({
      success: true,
      data: {
        today: {
          sales: todaySales,
          revenue: todayRevenue._sum.totalAmount || 0,
          orders: todayOrders,
          customers: todayCustomers.length
        },
        month: {
          sales: monthSales,
          revenue: monthRevenue._sum.totalAmount || 0,
          orders: monthOrders,
          growth: {
            revenue: parseFloat(revenueGrowth.toFixed(2)),
            sales: parseFloat(salesGrowth.toFixed(2))
          }
        },
        inventory: {
          totalItems,
          lowStock: lowStockItems,
          outOfStock: outOfStockItems,
          expiring: expiringItems
        },
        customers: {
          total: totalCustomers,
          active: activeCustomers
        }
      }
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/dashboard/recent-sales
// @desc    Get recent sales
// @access  Private
router.get('/recent-sales', auth, async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const orders = await prisma.order.findMany({
      take: parseInt(limit),
      orderBy: { createdAt: 'desc' },
      include: {
        customer: {
          select: { id: true, name: true, phone: true }
        },
        user: {
          select: { id: true, name: true }
        }
      }
    });

    res.json({
      success: true,
      data: { orders }
    });
  } catch (error) {
    console.error('Get recent sales error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/dashboard/top-items
// @desc    Get top selling items
// @access  Private
router.get('/top-items', auth, async (req, res) => {
  try {
    const { limit = 10, period = 'month' } = req.query;

    let startDate;
    const today = new Date();
    
    switch (period) {
      case 'today':
        startDate = new Date(today);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'week':
        startDate = new Date(today);
        startDate.setDate(today.getDate() - 7);
        break;
      case 'month':
        startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        break;
      case 'year':
        startDate = new Date(today.getFullYear(), 0, 1);
        break;
      default:
        startDate = new Date(today.getFullYear(), today.getMonth(), 1);
    }

    const topItems = await prisma.orderItem.groupBy({
      by: ['itemId'],
      where: {
        order: {
          createdAt: { gte: startDate },
          orderStatus: 'COMPLETED'
        }
      },
      _sum: {
        quantity: true,
        totalAmount: true
      },
      orderBy: {
        _sum: {
          totalAmount: 'desc'
        }
      },
      take: parseInt(limit)
    });

    // Get item details
    const itemsWithDetails = await Promise.all(
      topItems.map(async (item) => {
        const itemDetails = await prisma.item.findUnique({
          where: { id: item.itemId },
          select: { id: true, name: true, barcode: true, price: true }
        });

        return {
          ...item,
          item: itemDetails
        };
      })
    );

    res.json({
      success: true,
      data: { items: itemsWithDetails }
    });
  } catch (error) {
    console.error('Get top items error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/dashboard/sales-chart
// @desc    Get sales data for chart
// @access  Private
router.get('/sales-chart', auth, async (req, res) => {
  try {
    const { period = 'week' } = req.query;

    let startDate, groupBy;
    const today = new Date();
    
    switch (period) {
      case 'today':
        startDate = new Date(today);
        startDate.setHours(0, 0, 0, 0);
        groupBy = 'hour';
        break;
      case 'week':
        startDate = new Date(today);
        startDate.setDate(today.getDate() - 7);
        groupBy = 'day';
        break;
      case 'month':
        startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        groupBy = 'day';
        break;
      case 'year':
        startDate = new Date(today.getFullYear(), 0, 1);
        groupBy = 'month';
        break;
      default:
        startDate = new Date(today);
        startDate.setDate(today.getDate() - 7);
        groupBy = 'day';
    }

    const sales = await prisma.order.groupBy({
      by: ['createdAt'],
      where: {
        createdAt: { gte: startDate },
        orderStatus: 'COMPLETED'
      },
      _sum: {
        totalAmount: true
      },
      _count: {
        id: true
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    // Format data for chart
    const formattedData = sales.map(sale => ({
      date: sale.createdAt,
      revenue: sale._sum.totalAmount || 0,
      orders: sale._count.id
    }));

    res.json({
      success: true,
      data: { sales: formattedData, period }
    });
  } catch (error) {
    console.error('Get sales chart error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/dashboard/low-stock
// @desc    Get low stock items
// @access  Private
router.get('/low-stock', auth, async (req, res) => {
  try {
    const items = await prisma.item.findMany({
      where: {
        isActive: true,
        quantity: { lte: 5 }
      },
      include: {
        category: {
          select: { id: true, name: true }
        }
      },
      orderBy: { quantity: 'asc' },
      take: 20
    });

    res.json({
      success: true,
      data: { items }
    });
  } catch (error) {
    console.error('Get low stock items error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/dashboard/expiring
// @desc    Get expiring items
// @access  Private
router.get('/expiring', auth, async (req, res) => {
  try {
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const items = await prisma.item.findMany({
      where: {
        isActive: true,
        expiryDate: {
          lte: sevenDaysFromNow,
          gte: new Date()
        }
      },
      include: {
        category: {
          select: { id: true, name: true }
        }
      },
      orderBy: { expiryDate: 'asc' },
      take: 20
    });

    res.json({
      success: true,
      data: { items }
    });
  } catch (error) {
    console.error('Get expiring items error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;
