import { validationResult } from "express-validator";
import User from "../models/User.js";
import Account from "../models/Account.js";
import Transaction from "../models/Transaction.js";
import FixedDeposit from "../models/FixedDeposit.js";
import RecurringDeposit from "../models/RecurringDeposit.js";
import mongoose from "mongoose";

// Helper function to format validation errors
const formatValidationErrors = (errors) => {
  return errors.array().map((error) => ({
    field: error.path,
    message: error.msg,
    value: error.value,
  }));
};

// Get dashboard statistics
export const getDashboardStats = async (req, res) => {
  try {
    // Get basic counts
    const totalCustomers = await User.countDocuments({
      role: "customer",
      isActive: true,
    });
    const totalAccounts = await Account.countDocuments({ isActive: true });
    const totalFDs = await FixedDeposit.countDocuments({ status: "active" });
    const totalRDs = await RecurringDeposit.countDocuments({
      status: "active",
    });

    // Get transaction stats (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentTransactions = await Transaction.countDocuments({
      createdAt: { $gte: thirtyDaysAgo },
      status: "completed",
    });

    // Get total deposits across all accounts
    const totalDepositsResult = await Account.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: null, totalBalance: { $sum: "$balance" } } },
    ]);
    const totalDeposits = totalDepositsResult[0]?.totalBalance || 0;

    // Get FD investments
    const fdInvestmentResult = await FixedDeposit.aggregate([
      { $match: { status: "active" } },
      { $group: { _id: null, totalInvestment: { $sum: "$principalAmount" } } },
    ]);
    const totalFDInvestment = fdInvestmentResult[0]?.totalInvestment || 0;

    // Get RD investments
    const rdInvestmentResult = await RecurringDeposit.aggregate([
      { $match: { status: "active" } },
      { $group: { _id: null, totalDeposited: { $sum: "$totalDeposited" } } },
    ]);
    const totalRDInvestment = rdInvestmentResult[0]?.totalDeposited || 0;

    // Transaction volume by type (last 30 days)
    const transactionVolume = await Transaction.aggregate([
      {
        $match: {
          createdAt: { $gte: thirtyDaysAgo },
          status: "completed",
        },
      },
      {
        $group: {
          _id: "$transactionType",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
      { $sort: { totalAmount: -1 } },
    ]);

    // Account type distribution
    const accountDistribution = await Account.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: "$accountType",
          count: { $sum: 1 },
          totalBalance: { $sum: "$balance" },
        },
      },
    ]);

    const stats = {
      customers: {
        total: totalCustomers,
        active: totalCustomers, // All counted customers are active
      },
      accounts: {
        total: totalAccounts,
        distribution: accountDistribution,
      },
      deposits: {
        totalBalance: totalDeposits,
        fixedDeposits: {
          count: totalFDs,
          totalInvestment: totalFDInvestment,
        },
        recurringDeposits: {
          count: totalRDs,
          totalInvestment: totalRDInvestment,
        },
      },
      transactions: {
        recentCount: recentTransactions,
        volumeByType: transactionVolume,
      },
    };

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Get dashboard stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard statistics",
    });
  }
};

// Get all customers with pagination
export const getCustomers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 25,
      search,
      status,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const query = { role: "customer" };

    // Add search functionality
    if (search) {
      const searchRegex = new RegExp(search, "i");
      query.$or = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
      ];
    }

    // Add status filter
    if (status !== undefined) {
      query.isActive = status === "active";
    }

    const skip = (page - 1) * limit;
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;

    const customers = await User.find(query)
      .select("-password")
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const totalCustomers = await User.countDocuments(query);

    // Get account counts for each customer
    const customersWithAccounts = await Promise.all(
      customers.map(async (customer) => {
        const accountCount = await Account.countDocuments({
          userId: customer._id,
          isActive: true,
        });

        return {
          customerId: customer._id,
          firstName: customer.firstName,
          lastName: customer.lastName,
          fullName: customer.fullName,
          email: customer.email,
          phone: customer.phone,
          address: customer.formattedAddress,
          dateOfBirth: customer.dateOfBirth,
          isActive: customer.isActive,
          lastLogin: customer.lastLogin,
          accountCount,
          createdAt: customer.createdAt,
          updatedAt: customer.updatedAt,
        };
      })
    );

    res.status(200).json({
      success: true,
      data: {
        customers: customersWithAccounts,
        pagination: {
          currentPage: parseInt(page),
          limit: parseInt(limit),
          totalCustomers,
          totalPages: Math.ceil(totalCustomers / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get customers error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch customers",
    });
  }
};

// Get customer details with accounts and transactions
export const getCustomerDetails = async (req, res) => {
  try {
    const { customerId } = req.params;

    const customer = await User.findById(customerId).select("-password");
    if (!customer || customer.role !== "customer") {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // Get customer's accounts
    const accounts = await Account.find({ userId: customerId });

    // Get recent transactions (last 10)
    const recentTransactions = await Transaction.find({
      $or: [
        { fromAccountId: { $in: accounts.map((acc) => acc._id) } },
        { toAccountId: { $in: accounts.map((acc) => acc._id) } },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate("fromAccountId", "accountNumber accountType")
      .populate("toAccountId", "accountNumber accountType");

    // Get FDs and RDs
    const fixedDeposits = await FixedDeposit.find({
      userId: customerId,
    }).select("fdNumber principalAmount status createdAt");
    const recurringDeposits = await RecurringDeposit.find({
      userId: customerId,
    }).select("rdNumber monthlyAmount status createdAt");

    const customerData = {
      customerId: customer._id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      fullName: customer.fullName,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      formattedAddress: customer.formattedAddress,
      dateOfBirth: customer.dateOfBirth,
      isActive: customer.isActive,
      lastLogin: customer.lastLogin,
      loginAttempts: customer.loginAttempts,
      accountLocked: customer.accountLocked,
      accounts: accounts.map((acc) => ({
        accountId: acc._id,
        accountNumber: acc.accountNumber,
        accountType: acc.accountType,
        balance: acc.balance,
        status: acc.status,
        createdAt: acc.createdAt,
      })),
      recentTransactions: recentTransactions.map((txn) => ({
        transactionId: txn.transactionId,
        amount: txn.amount,
        type: txn.transactionType,
        description: txn.description,
        status: txn.status,
        createdAt: txn.createdAt,
      })),
      investments: {
        fixedDeposits: fixedDeposits.length,
        recurringDeposits: recurringDeposits.length,
        totalFDAmount: fixedDeposits.reduce(
          (sum, fd) => sum + fd.principalAmount,
          0
        ),
        totalRDAmount: recurringDeposits.reduce(
          (sum, rd) => sum + (rd.monthlyAmount * rd.installmentsPaid || 0),
          0
        ),
      },
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    };

    res.status(200).json({
      success: true,
      data: customerData,
    });
  } catch (error) {
    console.error("Get customer details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch customer details",
    });
  }
};

// Freeze/Unfreeze customer account
export const toggleCustomerStatus = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { action, reason } = req.body; // action: 'freeze' or 'unfreeze'

    const customer = await User.findById(customerId);
    if (!customer || customer.role !== "customer") {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    if (action === "freeze") {
      customer.isActive = false;

      // Also freeze all customer accounts
      await Account.updateMany(
        { userId: customerId },
        {
          isActive: false,
          freezeReason: "admin_action",
        }
      );
    } else if (action === "unfreeze") {
      customer.isActive = true;
      customer.loginAttempts = 0;
      customer.accountLocked = false;
      customer.lockUntil = undefined;

      // Unfreeze all customer accounts
      await Account.updateMany(
        { userId: customerId },
        {
          isActive: true,
          freezeReason: "none",
        }
      );
    }

    await customer.save();

    res.status(200).json({
      success: true,
      message: `Customer ${action}d successfully`,
      data: {
        customerId: customer._id,
        isActive: customer.isActive,
        action,
        reason: reason || "Admin action",
        timestamp: new Date(),
      },
    });
  } catch (error) {
    console.error("Toggle customer status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update customer status",
    });
  }
};

// Get all accounts with filters
export const getAllAccounts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 25,
      accountType,
      status,
      minBalance,
      maxBalance,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const query = {};

    // Add filters
    if (accountType) {
      query.accountType = accountType;
    }

    if (status === "active") {
      query.isActive = true;
      query.freezeReason = "none";
    } else if (status === "frozen") {
      query.freezeReason = { $ne: "none" };
    } else if (status === "inactive") {
      query.isActive = false;
    }

    if (minBalance !== undefined) {
      query.balance = { ...query.balance, $gte: parseFloat(minBalance) };
    }

    if (maxBalance !== undefined) {
      query.balance = { ...query.balance, $lte: parseFloat(maxBalance) };
    }

    const skip = (page - 1) * limit;
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;

    const accounts = await Account.find(query)
      .populate("userId", "firstName lastName email phone")
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const totalAccounts = await Account.countDocuments(query);

    const accountsData = accounts.map((acc) => ({
      accountId: acc._id,
      accountNumber: acc.accountNumber,
      accountType: acc.accountType,
      balance: acc.balance,
      availableBalance: acc.availableBalance,
      minimumBalance: acc.minimumBalance,
      status: acc.status,
      freezeReason: acc.freezeReason,
      customer: {
        customerId: acc.userId._id,
        name: acc.userId.fullName,
        email: acc.userId.email,
        phone: acc.userId.phone,
      },
      createdAt: acc.createdAt,
      updatedAt: acc.updatedAt,
    }));

    res.status(200).json({
      success: true,
      data: {
        accounts: accountsData,
        pagination: {
          currentPage: parseInt(page),
          limit: parseInt(limit),
          totalAccounts,
          totalPages: Math.ceil(totalAccounts / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get all accounts error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch accounts",
    });
  }
};

// Freeze/Unfreeze account
export const toggleAccountStatus = async (req, res) => {
  try {
    const { accountId } = req.params;
    const { action, reason } = req.body;

    const account = await Account.findById(accountId).populate(
      "userId",
      "firstName lastName email"
    );

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    if (action === "freeze") {
      await account.freeze(reason || "admin_action");
    } else if (action === "unfreeze") {
      await account.unfreeze();
    }

    res.status(200).json({
      success: true,
      message: `Account ${action}d successfully`,
      data: {
        accountNumber: account.accountNumber,
        customerId: account.userId._id,
        customerName: account.userId.fullName,
        status: account.status,
        action,
        reason: reason || "Admin action",
        timestamp: new Date(),
      },
    });
  } catch (error) {
    console.error("Toggle account status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update account status",
    });
  }
};

// Get transactions with advanced filters
export const getAllTransactions = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      transactionType,
      status,
      minAmount,
      maxAmount,
      startDate,
      endDate,
      accountNumber,
      customerId,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const query = {};

    // Add filters
    if (transactionType) {
      query.transactionType = transactionType;
    }

    if (status) {
      query.status = status;
    }

    if (minAmount !== undefined) {
      query.amount = { ...query.amount, $gte: parseFloat(minAmount) };
    }

    if (maxAmount !== undefined) {
      query.amount = { ...query.amount, $lte: parseFloat(maxAmount) };
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    if (accountNumber) {
      query.$or = [
        { fromAccountNumber: accountNumber },
        { toAccountNumber: accountNumber },
      ];
    }

    if (customerId) {
      const customerAccounts = await Account.find({ userId: customerId });
      const accountIds = customerAccounts.map((acc) => acc._id);
      query.$or = [
        { fromAccountId: { $in: accountIds } },
        { toAccountId: { $in: accountIds } },
      ];
    }

    const skip = (page - 1) * limit;
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;

    const transactions = await Transaction.find(query)
      .populate("fromAccountId", "accountNumber accountType userId")
      .populate("toAccountId", "accountNumber accountType userId")
      .populate("metadata.initiatedBy", "firstName lastName")
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const totalTransactions = await Transaction.countDocuments(query);

    const transactionsData = transactions.map((txn) => ({
      transactionId: txn.transactionId,
      amount: txn.amount,
      type: txn.transactionType,
      description: txn.description,
      status: txn.status,
      fromAccount: txn.fromAccountNumber,
      toAccount: txn.toAccountNumber,
      fees: txn.fees,
      createdAt: txn.createdAt,
      processedAt: txn.processedAt,
      initiatedBy: txn.metadata.initiatedBy?.fullName,
      channel: txn.metadata.channel,
    }));

    res.status(200).json({
      success: true,
      data: {
        transactions: transactionsData,
        pagination: {
          currentPage: parseInt(page),
          limit: parseInt(limit),
          totalTransactions,
          totalPages: Math.ceil(totalTransactions / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get all transactions error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch transactions",
    });
  }
};

// Create admin user (for initial setup)
export const createAdmin = async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatValidationErrors(errors),
      });
    }

    const { email, password, firstName, lastName, phone, address } = req.body;

    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: email.toLowerCase() });
    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        message: "Admin with this email already exists",
      });
    }

    // Create admin user
    const admin = await User.createAdmin({
      email: email.toLowerCase(),
      password,
      firstName,
      lastName,
      phone,
      address,
      dateOfBirth: new Date("1990-01-01"), // Default DOB for admin
    });

    res.status(201).json({
      success: true,
      message: "Admin created successfully",
      data: {
        adminId: admin._id,
        email: admin.email,
        firstName: admin.firstName,
        lastName: admin.lastName,
        role: admin.role,
      },
    });
  } catch (error) {
    console.error("Create admin error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create admin",
    });
  }
};
