const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    transactionId: {
      type: String,
      unique: true,
      required: true,
      index: true,
    },
    fromAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      index: true,
      default: null, // null for deposits/credits from external sources
    },
    toAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      index: true,
      default: null, // null for withdrawals/debits to external sources
    },
    fromAccountNumber: {
      type: String,
      index: true,
      default: null,
    },
    toAccountNumber: {
      type: String,
      index: true,
      default: null,
    },
    amount: {
      type: Number,
      required: [true, "Amount is required"],
      min: [0.01, "Amount must be greater than 0"],
      validate: {
        validator: function (value) {
          return Number.isFinite(value) && value > 0;
        },
        message: "Amount must be a positive number",
      },
    },
    transactionType: {
      type: String,
      enum: [
        "transfer", // Between accounts
        "deposit", // Cash deposit
        "withdrawal", // Cash withdrawal
        "fd_deposit", // Fixed deposit creation
        "fd_maturity", // Fixed deposit maturity
        "rd_deposit", // Recurring deposit installment
        "rd_maturity", // Recurring deposit maturity
        "interest_credit", // Interest credited
        "fee_debit", // Service fee deducted
        "penalty_debit", // Penalty deducted
        "reversal", // Transaction reversal
      ],
      required: true,
      index: true,
    },
    description: {
      type: String,
      required: [true, "Description is required"],
      maxlength: [500, "Description cannot exceed 500 characters"],
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "reversed"],
      default: "pending",
      index: true,
    },
    reference: {
      type: String,
      index: true,
      default: null, // For external references like FD/RD numbers
    },
    metadata: {
      // Additional transaction details
      beneficiaryName: String,
      initiatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      channel: {
        type: String,
        enum: ["web", "mobile", "atm", "branch", "system"],
        default: "web",
      },
      location: String,
      deviceInfo: String,
      ipAddress: String,
    },
    fees: {
      transactionFee: {
        type: Number,
        default: 0,
        min: 0,
      },
      gst: {
        type: Number,
        default: 0,
        min: 0,
      },
      totalFees: {
        type: Number,
        default: 0,
        min: 0,
      },
    },
    balances: {
      // Account balances after transaction
      fromAccountBalance: Number,
      toAccountBalance: Number,
    },
    processedAt: {
      type: Date,
      index: true,
    },
    failureReason: {
      type: String,
      maxlength: [200, "Failure reason cannot exceed 200 characters"],
    },
    reversalTransactionId: {
      type: String,
      index: true,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for formatted amount
transactionSchema.virtual("formattedAmount").get(function () {
  return `₹${this.amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
});

// Virtual for transaction direction (for account-specific view)
transactionSchema.virtual("getDirection").get(function () {
  return function (accountId) {
    if (
      this.fromAccountId &&
      this.fromAccountId.toString() === accountId.toString()
    ) {
      return "debit";
    } else if (
      this.toAccountId &&
      this.toAccountId.toString() === accountId.toString()
    ) {
      return "credit";
    }
    return "unknown";
  };
});

// Virtual for formatted transaction ID
transactionSchema.virtual("formattedTransactionId").get(function () {
  return this.transactionId.toUpperCase();
});

// Indexes for better query performance
transactionSchema.index({ fromAccountId: 1, createdAt: -1 });
transactionSchema.index({ toAccountId: 1, createdAt: -1 });
transactionSchema.index({ transactionType: 1, createdAt: -1 });
transactionSchema.index({ status: 1, createdAt: -1 });
transactionSchema.index({ createdAt: -1 });
transactionSchema.index({ "metadata.initiatedBy": 1, createdAt: -1 });

// Pre-save middleware to generate transaction ID and calculate fees
transactionSchema.pre("save", async function (next) {
  if (this.isNew) {
    // Generate unique transaction ID
    if (!this.transactionId) {
      this.transactionId = await generateTransactionId();
    }

    // Calculate fees based on transaction type and amount
    if (this.fees.totalFees === 0) {
      const feeCalculation = calculateTransactionFees(
        this.transactionType,
        this.amount
      );
      this.fees = {
        ...this.fees,
        ...feeCalculation,
      };
    }

    // Set account numbers from account IDs
    if (this.fromAccountId && !this.fromAccountNumber) {
      const Account = mongoose.model("Account");
      const fromAccount = await Account.findById(this.fromAccountId);
      if (fromAccount) {
        this.fromAccountNumber = fromAccount.accountNumber;
      }
    }

    if (this.toAccountId && !this.toAccountNumber) {
      const Account = mongoose.model("Account");
      const toAccount = await Account.findById(this.toAccountId);
      if (toAccount) {
        this.toAccountNumber = toAccount.accountNumber;
      }
    }
  }

  next();
});

// Static method to generate unique transaction ID
async function generateTransactionId() {
  const prefix = "TXN";
  const date = new Date();
  const dateStr =
    date.getFullYear().toString() +
    (date.getMonth() + 1).toString().padStart(2, "0") +
    date.getDate().toString().padStart(2, "0");

  let isUnique = false;
  let transactionId;

  while (!isUnique) {
    const randomDigits = Math.floor(Math.random() * 1000000)
      .toString()
      .padStart(6, "0");
    transactionId = `${prefix}${dateStr}${randomDigits}`;

    const existingTransaction = await mongoose
      .model("Transaction")
      .findOne({ transactionId });
    if (!existingTransaction) {
      isUnique = true;
    }
  }

  return transactionId;
}

// Function to calculate transaction fees
function calculateTransactionFees(transactionType, amount) {
  let transactionFee = 0;

  switch (transactionType) {
    case "transfer":
      if (amount > 25000) {
        transactionFee = 5; // ₹5 for transfers above ₹25,000
      }
      break;
    case "withdrawal":
      // Free for first 4 withdrawals per month, then ₹20
      transactionFee = 0; // This would need to be calculated based on monthly withdrawal count
      break;
    default:
      transactionFee = 0;
  }

  const gst = transactionFee * 0.18; // 18% GST on fees
  const totalFees = transactionFee + gst;

  return {
    transactionFee: Math.round(transactionFee * 100) / 100,
    gst: Math.round(gst * 100) / 100,
    totalFees: Math.round(totalFees * 100) / 100,
  };
}

// Method to mark transaction as completed
transactionSchema.methods.complete = async function (
  fromBalance = null,
  toBalance = null
) {
  this.status = "completed";
  this.processedAt = new Date();

  if (fromBalance !== null) {
    this.balances.fromAccountBalance = fromBalance;
  }
  if (toBalance !== null) {
    this.balances.toAccountBalance = toBalance;
  }

  return await this.save();
};

// Method to mark transaction as failed
transactionSchema.methods.fail = async function (reason) {
  this.status = "failed";
  this.processedAt = new Date();
  this.failureReason = reason;

  return await this.save();
};

// Method to reverse transaction
transactionSchema.methods.reverse = async function (reversalReason) {
  if (this.status !== "completed") {
    throw new Error("Can only reverse completed transactions");
  }

  // Create reversal transaction
  const reversalTransaction = new mongoose.model("Transaction")({
    fromAccountId: this.toAccountId,
    toAccountId: this.fromAccountId,
    fromAccountNumber: this.toAccountNumber,
    toAccountNumber: this.fromAccountNumber,
    amount: this.amount,
    transactionType: "reversal",
    description: `Reversal of transaction ${this.transactionId} - ${reversalReason}`,
    reference: this.transactionId,
    metadata: {
      ...this.metadata,
      originalTransactionId: this.transactionId,
    },
    status: "completed",
    processedAt: new Date(),
  });

  await reversalTransaction.save();

  // Mark original transaction as reversed
  this.status = "reversed";
  this.reversalTransactionId = reversalTransaction.transactionId;
  await this.save();

  return reversalTransaction;
};

// Static method to find transactions by account
transactionSchema.statics.findByAccount = function (accountId, options = {}) {
  const {
    page = 1,
    limit = 50,
    transactionType,
    status,
    startDate,
    endDate,
  } = options;

  const query = {
    $or: [{ fromAccountId: accountId }, { toAccountId: accountId }],
  };

  if (transactionType) {
    query.transactionType = transactionType;
  }

  if (status) {
    query.status = status;
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

  const skip = (page - 1) * limit;

  return this.find(query)
    .populate("fromAccountId", "accountNumber accountType")
    .populate("toAccountId", "accountNumber accountType")
    .populate("metadata.initiatedBy", "firstName lastName")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

// Static method to find transactions by user
transactionSchema.statics.findByUser = function (userId, options = {}) {
  const Account = mongoose.model("Account");

  return Account.find({ userId, isActive: true }).then((accounts) => {
    const accountIds = accounts.map((acc) => acc._id);

    const query = {
      $or: [
        { fromAccountId: { $in: accountIds } },
        { toAccountId: { $in: accountIds } },
      ],
    };

    // Add other filters
    if (options.transactionType) {
      query.transactionType = options.transactionType;
    }

    if (options.status) {
      query.status = options.status;
    }

    if (options.startDate || options.endDate) {
      query.createdAt = {};
      if (options.startDate) {
        query.createdAt.$gte = new Date(options.startDate);
      }
      if (options.endDate) {
        query.createdAt.$lte = new Date(options.endDate);
      }
    }

    const page = options.page || 1;
    const limit = options.limit || 50;
    const skip = (page - 1) * limit;

    return this.find(query)
      .populate("fromAccountId", "accountNumber accountType")
      .populate("toAccountId", "accountNumber accountType")
      .populate("metadata.initiatedBy", "firstName lastName")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
  });
};

// Static method for transaction analytics
transactionSchema.statics.getAnalytics = function (accountId, period = "30d") {
  const startDate = new Date();

  switch (period) {
    case "7d":
      startDate.setDate(startDate.getDate() - 7);
      break;
    case "30d":
      startDate.setDate(startDate.getDate() - 30);
      break;
    case "90d":
      startDate.setDate(startDate.getDate() - 90);
      break;
    case "1y":
      startDate.setFullYear(startDate.getFullYear() - 1);
      break;
  }

  return this.aggregate([
    {
      $match: {
        $or: [{ fromAccountId: accountId }, { toAccountId: accountId }],
        status: "completed",
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: "$transactionType",
        count: { $sum: 1 },
        totalAmount: { $sum: "$amount" },
        avgAmount: { $avg: "$amount" },
      },
    },
    {
      $sort: { totalAmount: -1 },
    },
  ]);
};

module.exports = mongoose.model("Transaction", transactionSchema);
