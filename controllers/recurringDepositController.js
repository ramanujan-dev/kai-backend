import { validationResult } from "express-validator";
import RecurringDeposit from "../models/RecurringDeposit.js";
import RDInstallment from "../models/RDInstallment.js";
import Account from "../models/Account.js";
import Transaction from "../models/Transaction.js";
import mongoose from "mongoose";

// Helper function to format validation errors
const formatValidationErrors = (errors) => {
  return errors.array().map((error) => ({
    field: error.path,
    message: error.msg,
    value: error.value,
  }));
};

// Get RD interest rates
export const getRDRates = async (req, res) => {
  try {
    // Static RD rates - in real app, this would come from database
    const rates = [
      { tenure: 12, rate: 6.8, description: "1 year" },
      { tenure: 18, rate: 7.0, description: "18 months" },
      { tenure: 24, rate: 7.25, description: "2 years" },
      { tenure: 36, rate: 7.5, description: "3 years" },
      { tenure: 60, rate: 7.75, description: "5 years" },
      { tenure: 120, rate: 8.0, description: "10 years" },
    ];

    res.status(200).json({
      success: true,
      data: rates,
    });
  } catch (error) {
    console.error("Get RD rates error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch RD rates",
    });
  }
};

// Create new Recurring Deposit
export const createRecurringDeposit = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatValidationErrors(errors),
      });
    }

    const {
      fromAccountNumber,
      monthlyAmount,
      tenure,
      nominee,
      autoDebit = true,
    } = req.body;
    const userId = req.user.userId;

    // Find source account
    const fromAccount = await Account.findOne({
      accountNumber: fromAccountNumber,
      userId,
      isActive: true,
    }).session(session);

    if (!fromAccount) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Source account not found or inactive",
      });
    }

    // Check if account has sufficient balance for first installment
    const canTransact = fromAccount.canTransact(monthlyAmount);
    if (!canTransact.allowed) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: canTransact.reason,
      });
    }

    // Determine interest rate based on tenure
    let interestRate;
    if (tenure >= 12 && tenure < 18) interestRate = 6.8;
    else if (tenure >= 18 && tenure < 24) interestRate = 7.0;
    else if (tenure >= 24 && tenure < 36) interestRate = 7.25;
    else if (tenure >= 36 && tenure < 60) interestRate = 7.5;
    else if (tenure >= 60 && tenure < 120) interestRate = 7.75;
    else if (tenure >= 120) interestRate = 8.0;
    else {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Invalid tenure. Minimum 12 months required.",
      });
    }

    // Create Recurring Deposit
    const recurringDeposit = new RecurringDeposit({
      userId,
      fromAccountId: fromAccount._id,
      monthlyAmount,
      interestRate,
      tenure,
      nominee,
      autoDebit: {
        enabled: autoDebit,
      },
    });

    await recurringDeposit.save({ session });

    // Create installment schedule
    await RDInstallment.createSchedule(
      recurringDeposit._id,
      monthlyAmount,
      recurringDeposit.startDate,
      tenure
    );

    // Process first installment immediately
    const firstInstallmentResult = await recurringDeposit.processInstallment(
      new Date()
    );

    await session.commitTransaction();

    // Return RD details
    const rdData = {
      rdId: recurringDeposit._id,
      rdNumber: recurringDeposit.rdNumber,
      formattedRdNumber: recurringDeposit.formattedRdNumber,
      monthlyAmount: recurringDeposit.monthlyAmount,
      interestRate: recurringDeposit.interestRate,
      tenure: recurringDeposit.tenure,
      maturityAmount: recurringDeposit.maturityAmount,
      startDate: recurringDeposit.startDate,
      maturityDate: recurringDeposit.maturityDate,
      nextDueDate: recurringDeposit.nextDueDate,
      status: recurringDeposit.status,
      installmentsPaid: recurringDeposit.installmentsPaid,
      nominee: recurringDeposit.nominee,
      firstInstallmentTransaction: firstInstallmentResult.transactionId,
      createdAt: recurringDeposit.createdAt,
    };

    res.status(201).json({
      success: true,
      message: "Recurring Deposit created successfully",
      data: rdData,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Create RD error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create Recurring Deposit",
    });
  } finally {
    session.endSession();
  }
};

// Get user's Recurring Deposits
export const getUserRecurringDeposits = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status, page = 1, limit = 10 } = req.query;

    const query = { userId };
    if (status) {
      query.status = status;
    }

    const skip = (page - 1) * limit;

    const recurringDeposits = await RecurringDeposit.find(query)
      .populate("fromAccountId", "accountNumber accountType")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalRDs = await RecurringDeposit.countDocuments(query);

    const rdData = recurringDeposits.map((rd) => ({
      rdId: rd._id,
      rdNumber: rd.rdNumber,
      formattedRdNumber: rd.formattedRdNumber,
      monthlyAmount: rd.monthlyAmount,
      interestRate: rd.interestRate,
      tenure: rd.tenure,
      maturityAmount: rd.maturityAmount,
      startDate: rd.startDate,
      maturityDate: rd.maturityDate,
      nextDueDate: rd.nextDueDate,
      status: rd.status,
      installmentsPaid: rd.installmentsPaid,
      installmentsMissed: rd.installmentsMissed,
      totalDeposited: rd.totalDeposited,
      penaltyAmount: rd.penaltyAmount,
      daysUntilDue: rd.daysUntilDue,
      isOverdue: rd.isOverdue,
      completionPercentage: rd.completionPercentage,
      currentInterestEarned: rd.currentInterestEarned,
      fromAccount: rd.fromAccountId?.accountNumber,
      autoDebitEnabled: rd.autoDebit.enabled,
      createdAt: rd.createdAt,
    }));

    res.status(200).json({
      success: true,
      data: {
        recurringDeposits: rdData,
        pagination: {
          currentPage: parseInt(page),
          limit: parseInt(limit),
          totalRDs,
          totalPages: Math.ceil(totalRDs / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get RDs error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch Recurring Deposits",
    });
  }
};

// Get Recurring Deposit details
export const getRecurringDepositDetails = async (req, res) => {
  try {
    const { rdNumber } = req.params;
    const userId = req.user.userId;

    const recurringDeposit = await RecurringDeposit.findOne({
      rdNumber,
      userId,
    })
      .populate("userId", "firstName lastName email phone")
      .populate("fromAccountId", "accountNumber accountType");

    if (!recurringDeposit) {
      return res.status(404).json({
        success: false,
        message: "Recurring Deposit not found",
      });
    }

    // Get installment history
    const installments = await RDInstallment.findByRD(recurringDeposit._id);

    const rdData = {
      rdId: recurringDeposit._id,
      rdNumber: recurringDeposit.rdNumber,
      formattedRdNumber: recurringDeposit.formattedRdNumber,
      monthlyAmount: recurringDeposit.monthlyAmount,
      formattedMonthlyAmount: recurringDeposit.formattedMonthlyAmount,
      interestRate: recurringDeposit.interestRate,
      tenure: recurringDeposit.tenure,
      maturityAmount: recurringDeposit.maturityAmount,
      formattedMaturityAmount: recurringDeposit.formattedMaturityAmount,
      startDate: recurringDeposit.startDate,
      maturityDate: recurringDeposit.maturityDate,
      nextDueDate: recurringDeposit.nextDueDate,
      status: recurringDeposit.status,
      installmentsPaid: recurringDeposit.installmentsPaid,
      installmentsMissed: recurringDeposit.installmentsMissed,
      totalDeposited: recurringDeposit.totalDeposited,
      formattedTotalDeposited: recurringDeposit.formattedTotalDeposited,
      expectedTotalDeposit: recurringDeposit.expectedTotalDeposit,
      penaltyAmount: recurringDeposit.penaltyAmount,
      daysUntilDue: recurringDeposit.daysUntilDue,
      isOverdue: recurringDeposit.isOverdue,
      completionPercentage: recurringDeposit.completionPercentage,
      currentInterestEarned: recurringDeposit.currentInterestEarned,
      nominee: recurringDeposit.nominee,
      autoDebit: recurringDeposit.autoDebit,
      fromAccount: {
        accountNumber: recurringDeposit.fromAccountId.accountNumber,
        accountType: recurringDeposit.fromAccountId.accountType,
      },
      maturityDetails: recurringDeposit.maturityDetails,
      closureDetails: recurringDeposit.closureDetails,
      installments: installments.map((inst) => ({
        installmentNumber: inst.installmentNumber,
        amount: inst.amount,
        penaltyAmount: inst.penaltyAmount,
        totalAmount: inst.totalAmount,
        dueDate: inst.dueDate,
        paidDate: inst.paidDate,
        status: inst.status,
        daysOverdue: inst.daysOverdue,
        paymentMethod: inst.paymentMethod,
      })),
      createdAt: recurringDeposit.createdAt,
      updatedAt: recurringDeposit.updatedAt,
    };

    res.status(200).json({
      success: true,
      data: rdData,
    });
  } catch (error) {
    console.error("Get RD details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch Recurring Deposit details",
    });
  }
};

// Pay RD installment manually
export const payInstallment = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { rdNumber } = req.params;
    const { paymentMethod = "manual" } = req.body;
    const userId = req.user.userId;

    const recurringDeposit = await RecurringDeposit.findOne({
      rdNumber,
      userId,
      status: "active",
    }).session(session);

    if (!recurringDeposit) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Active Recurring Deposit not found",
      });
    }

    if (recurringDeposit.installmentsPaid >= recurringDeposit.tenure) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "All installments have been paid",
      });
    }

    // Process the installment
    const result = await recurringDeposit.processInstallment(new Date());

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: "Installment paid successfully",
      data: {
        rdNumber: recurringDeposit.rdNumber,
        installmentNumber: result.installmentNumber,
        amountPaid: result.amountPaid,
        penaltyAmount: result.penaltyAmount,
        transactionId: result.transactionId,
        nextDueDate: result.nextDueDate,
        remainingInstallments:
          recurringDeposit.tenure - recurringDeposit.installmentsPaid,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Pay installment error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to pay installment",
    });
  } finally {
    session.endSession();
  }
};

// Close Recurring Deposit prematurely
export const closeRecurringDeposit = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { rdNumber } = req.params;
    const { reason = "Customer request" } = req.body;
    const userId = req.user.userId;

    const recurringDeposit = await RecurringDeposit.findOne({
      rdNumber,
      userId,
      status: "active",
    }).session(session);

    if (!recurringDeposit) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Active Recurring Deposit not found",
      });
    }

    // Check if RD can be closed (usually after 12 months or 12 installments)
    if (recurringDeposit.installmentsPaid < 12) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "RD can only be closed after paying at least 12 installments",
      });
    }

    // Process premature closure
    const result = await recurringDeposit.closePremature(reason);

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: "Recurring Deposit closed successfully",
      data: {
        rdNumber: recurringDeposit.rdNumber,
        installmentsPaid: recurringDeposit.installmentsPaid,
        totalDeposited: recurringDeposit.totalDeposited,
        netAmount: result.netAmount,
        penaltyAmount: result.penaltyAmount,
        transactionId: result.transactionId,
        closureDate: new Date(),
      },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Close RD error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to close Recurring Deposit",
    });
  } finally {
    session.endSession();
  }
};

// Toggle auto-debit for RD
export const toggleAutoDebit = async (req, res) => {
  try {
    const { rdNumber } = req.params;
    const { enabled } = req.body;
    const userId = req.user.userId;

    const recurringDeposit = await RecurringDeposit.findOne({
      rdNumber,
      userId,
      status: "active",
    });

    if (!recurringDeposit) {
      return res.status(404).json({
        success: false,
        message: "Active Recurring Deposit not found",
      });
    }

    recurringDeposit.autoDebit.enabled = enabled;
    if (enabled) {
      // Reset failure count when enabling auto-debit
      recurringDeposit.autoDebit.failureCount = 0;
    }

    await recurringDeposit.save();

    res.status(200).json({
      success: true,
      message: `Auto-debit ${enabled ? "enabled" : "disabled"} successfully`,
      data: {
        rdNumber: recurringDeposit.rdNumber,
        autoDebitEnabled: recurringDeposit.autoDebit.enabled,
        failureCount: recurringDeposit.autoDebit.failureCount,
      },
    });
  } catch (error) {
    console.error("Toggle auto-debit error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update auto-debit setting",
    });
  }
};

// Get overdue RDs for user
export const getOverdueInstallments = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get user's RDs
    const userRDs = await RecurringDeposit.find({
      userId,
      status: "active",
    }).populate("fromAccountId", "accountNumber accountType balance");

    // Filter overdue RDs
    const overdueRDs = userRDs.filter((rd) => rd.isOverdue);

    const overdueData = overdueRDs.map((rd) => ({
      rdId: rd._id,
      rdNumber: rd.rdNumber,
      formattedRdNumber: rd.formattedRdNumber,
      monthlyAmount: rd.monthlyAmount,
      nextDueDate: rd.nextDueDate,
      daysOverdue: Math.floor(
        (new Date() - new Date(rd.nextDueDate)) / (1000 * 60 * 60 * 24)
      ),
      installmentsPaid: rd.installmentsPaid,
      totalInstallments: rd.tenure,
      penaltyAmount: rd.penaltyAmount,
      autoDebitEnabled: rd.autoDebit.enabled,
      autoDebitFailures: rd.autoDebit.failureCount,
      fromAccount: rd.fromAccountId.accountNumber,
      accountBalance: rd.fromAccountId.balance,
    }));

    res.status(200).json({
      success: true,
      data: {
        overdueCount: overdueData.length,
        overdueRDs: overdueData,
      },
    });
  } catch (error) {
    console.error("Get overdue RDs error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch overdue installments",
    });
  }
};

// Get RD analytics
export const getRDAnalytics = async (req, res) => {
  try {
    const userId = req.user.userId;

    const analytics = await RecurringDeposit.getAnalytics(userId);

    // Get total investment summary
    const totalRDs = await RecurringDeposit.find({ userId });
    const activeRDs = totalRDs.filter((rd) => rd.status === "active");

    const totalMonthlyCommitment = activeRDs.reduce(
      (sum, rd) => sum + rd.monthlyAmount,
      0
    );
    const totalDeposited = totalRDs.reduce(
      (sum, rd) => sum + rd.totalDeposited,
      0
    );
    const totalMaturityValue = activeRDs.reduce(
      (sum, rd) => sum + rd.maturityAmount,
      0
    );

    // Calculate total expected returns
    const totalExpectedDeposit = activeRDs.reduce(
      (sum, rd) => sum + rd.monthlyAmount * rd.tenure,
      0
    );
    const totalExpectedReturns = totalMaturityValue - totalExpectedDeposit;

    // Get overdue count
    const overdueCount = activeRDs.filter((rd) => rd.isOverdue).length;

    const summary = {
      totalRDs: totalRDs.length,
      activeRDs: activeRDs.length,
      overdueRDs: overdueCount,
      totalMonthlyCommitment,
      totalDeposited,
      totalMaturityValue,
      totalExpectedReturns,
      avgInterestRate:
        activeRDs.length > 0
          ? activeRDs.reduce((sum, rd) => sum + rd.interestRate, 0) /
            activeRDs.length
          : 0,
      avgTenure:
        activeRDs.length > 0
          ? activeRDs.reduce((sum, rd) => sum + rd.tenure, 0) / activeRDs.length
          : 0,
    };

    res.status(200).json({
      success: true,
      data: {
        summary,
        analytics,
      },
    });
  } catch (error) {
    console.error("Get RD analytics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch RD analytics",
    });
  }
};

// Get installment calendar (upcoming due dates)
export const getInstallmentCalendar = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { months = 3 } = req.query; // Next 3 months by default

    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + parseInt(months));

    // Get active RDs
    const activeRDs = await RecurringDeposit.find({
      userId,
      status: "active",
      nextDueDate: { $lte: endDate },
    }).sort({ nextDueDate: 1 });

    const calendar = activeRDs.map((rd) => {
      const dueDate = new Date(rd.nextDueDate);
      const isOverdue = dueDate < new Date();
      const daysUntilDue = Math.ceil(
        (dueDate - new Date()) / (1000 * 60 * 60 * 24)
      );

      return {
        rdNumber: rd.rdNumber,
        formattedRdNumber: rd.formattedRdNumber,
        monthlyAmount: rd.monthlyAmount,
        dueDate: rd.nextDueDate,
        isOverdue,
        daysUntilDue: isOverdue ? 0 : Math.max(0, daysUntilDue),
        daysOverdue: isOverdue ? Math.abs(daysUntilDue) : 0,
        installmentNumber: rd.installmentsPaid + 1,
        totalInstallments: rd.tenure,
        autoDebitEnabled: rd.autoDebit.enabled,
        penaltyIfLate: isOverdue
          ? Math.min(Math.abs(daysUntilDue) * 10, rd.monthlyAmount * 0.1)
          : 0,
      };
    });

    res.status(200).json({
      success: true,
      data: {
        calendar,
        totalUpcoming: calendar.length,
        totalOverdue: calendar.filter((item) => item.isOverdue).length,
      },
    });
  } catch (error) {
    console.error("Get installment calendar error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch installment calendar",
    });
  }
};
