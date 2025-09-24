import mongoose from "mongoose";

const recurringDepositSchema = new mongoose.Schema(
  {
    rdNumber: {
      type: String,
      unique: true,
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
      index: true,
    },
    fromAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: [true, "Source account is required"],
      index: true,
    },
    monthlyAmount: {
      type: Number,
      required: [true, "Monthly amount is required"],
      min: [500, "Minimum RD amount is ₹500 per month"],
      max: [100000, "Maximum RD amount is ₹1,00,000 per month"],
      validate: {
        validator: function (value) {
          return Number.isFinite(value) && value >= 500;
        },
        message: "Monthly amount must be at least ₹500",
      },
    },
    interestRate: {
      type: Number,
      required: [true, "Interest rate is required"],
      min: [1, "Interest rate must be at least 1%"],
      max: [12, "Interest rate cannot exceed 12%"],
    },
    tenure: {
      type: Number,
      required: [true, "Tenure is required"],
      min: [12, "Minimum tenure is 12 months"],
      max: [120, "Maximum tenure is 120 months (10 years)"],
    },
    totalDeposited: {
      type: Number,
      default: 0,
    },
    maturityAmount: {
      type: Number,
      required: true,
    },
    startDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
    maturityDate: {
      type: Date,
      required: true,
      index: true,
    },
    nextDueDate: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "matured", "closed", "defaulted"],
      default: "active",
      index: true,
    },
    installmentsPaid: {
      type: Number,
      default: 0,
    },
    installmentsMissed: {
      type: Number,
      default: 0,
    },
    penaltyAmount: {
      type: Number,
      default: 0,
    },
    nominee: {
      name: {
        type: String,
        required: [true, "Nominee name is required"],
        trim: true,
      },
      relationship: {
        type: String,
        required: [true, "Nominee relationship is required"],
        enum: [
          "spouse",
          "son",
          "daughter",
          "father",
          "mother",
          "brother",
          "sister",
          "other",
        ],
      },
      dateOfBirth: Date,
      share: {
        type: Number,
        default: 100,
        min: [1, "Nominee share must be at least 1%"],
        max: [100, "Nominee share cannot exceed 100%"],
      },
    },
    autoDebit: {
      enabled: {
        type: Boolean,
        default: true,
      },
      failureCount: {
        type: Number,
        default: 0,
      },
      lastFailureDate: Date,
      lastFailureReason: String,
    },
    maturityDetails: {
      processedDate: Date,
      creditedAccountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Account",
      },
      transactionId: String,
      totalInterestEarned: Number,
    },
    closureDetails: {
      closureDate: Date,
      reason: String,
      penaltyApplied: Number,
      netAmount: Number,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for formatted RD number
recurringDepositSchema.virtual("formattedRdNumber").get(function () {
  const num = this.rdNumber;
  return `RD-${num}`;
});

// Virtual for formatted amounts
recurringDepositSchema.virtual("formattedMonthlyAmount").get(function () {
  return `₹${this.monthlyAmount.toLocaleString("en-IN")}`;
});

recurringDepositSchema.virtual("formattedMaturityAmount").get(function () {
  return `₹${this.maturityAmount.toLocaleString("en-IN")}`;
});

recurringDepositSchema.virtual("formattedTotalDeposited").get(function () {
  return `₹${this.totalDeposited.toLocaleString("en-IN")}`;
});

// Virtual for expected total deposit
recurringDepositSchema.virtual("expectedTotalDeposit").get(function () {
  return this.monthlyAmount * this.tenure;
});

// Virtual for days until next due date
recurringDepositSchema.virtual("daysUntilDue").get(function () {
  if (this.status !== "active") return 0;
  const now = new Date();
  const due = new Date(this.nextDueDate);
  const diffTime = due - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
});

// Virtual for overdue status
recurringDepositSchema.virtual("isOverdue").get(function () {
  return this.status === "active" && new Date() > new Date(this.nextDueDate);
});

// Virtual for completion percentage
recurringDepositSchema.virtual("completionPercentage").get(function () {
  return Math.round((this.installmentsPaid / this.tenure) * 100);
});

// Virtual for total interest earned so far
recurringDepositSchema.virtual("currentInterestEarned").get(function () {
  if (this.installmentsPaid === 0) return 0;

  // Simplified compound interest calculation
  const monthlyRate = this.interestRate / (12 * 100);
  let totalAmount = 0;

  for (let i = 0; i < this.installmentsPaid; i++) {
    const monthsRemaining = this.tenure - i;
    totalAmount +=
      this.monthlyAmount * Math.pow(1 + monthlyRate, monthsRemaining);
  }

  return Math.round(totalAmount - this.totalDeposited);
});

// Indexes
recurringDepositSchema.index({ userId: 1, status: 1 });
recurringDepositSchema.index({ nextDueDate: 1, status: 1 });
recurringDepositSchema.index({ maturityDate: 1, status: 1 });
recurringDepositSchema.index({ startDate: 1 });

// Pre-save middleware
recurringDepositSchema.pre("save", async function (next) {
  if (this.isNew) {
    // Generate RD number
    if (!this.rdNumber) {
      this.rdNumber = await generateRDNumber();
    }

    // Calculate maturity date
    if (!this.maturityDate) {
      const startDate = new Date(this.startDate);
      const maturityDate = new Date(startDate);
      maturityDate.setMonth(maturityDate.getMonth() + this.tenure);
      this.maturityDate = maturityDate;
    }

    // Set next due date (first installment due immediately)
    if (!this.nextDueDate) {
      this.nextDueDate = new Date(this.startDate);
    }

    // Calculate maturity amount
    if (
      !this.maturityAmount ||
      this.isModified("monthlyAmount") ||
      this.isModified("interestRate") ||
      this.isModified("tenure")
    ) {
      this.maturityAmount = calculateRDMaturityAmount(
        this.monthlyAmount,
        this.interestRate,
        this.tenure
      );
    }
  }

  next();
});

// Generate unique RD number
async function generateRDNumber() {
  const year = new Date().getFullYear();
  let isUnique = false;
  let rdNumber;

  while (!isUnique) {
    const randomDigits = Math.floor(Math.random() * 1000000)
      .toString()
      .padStart(6, "0");
    rdNumber = `${year}${randomDigits}`;

    const existingRD = await mongoose
      .model("RecurringDeposit")
      .findOne({ rdNumber });
    if (!existingRD) {
      isUnique = true;
    }
  }

  return rdNumber;
}

// Calculate RD maturity amount using compound interest
function calculateRDMaturityAmount(monthlyAmount, interestRate, tenure) {
  const monthlyRate = interestRate / (12 * 100);
  let maturityAmount = 0;

  // Calculate compound interest for each installment
  for (let i = 0; i < tenure; i++) {
    const monthsRemaining = tenure - i;
    maturityAmount +=
      monthlyAmount * Math.pow(1 + monthlyRate, monthsRemaining);
  }

  return Math.round(maturityAmount);
}

// Method to process monthly installment
recurringDepositSchema.methods.processInstallment = async function (
  paymentDate = new Date()
) {
  if (this.status !== "active") {
    throw new Error("RD is not active");
  }

  const Account = mongoose.model("Account");
  const Transaction = mongoose.model("Transaction");
  const RDInstallment = mongoose.model("RDInstallment");

  // Check if account has sufficient balance
  const fromAccount = await Account.findById(this.fromAccountId);
  if (!fromAccount) {
    throw new Error("Source account not found");
  }

  let totalAmount = this.monthlyAmount;
  let penaltyAmount = 0;

  // Calculate penalty if overdue
  if (this.isOverdue) {
    const overdueDays = Math.floor(
      (paymentDate - new Date(this.nextDueDate)) / (1000 * 60 * 60 * 24)
    );
    penaltyAmount = Math.min(overdueDays * 10, this.monthlyAmount * 0.1); // ₹10 per day or 10% of installment, whichever is lower
    totalAmount += penaltyAmount;
  }

  // Check if account can handle the debit
  const canTransact = fromAccount.canTransact(totalAmount);
  if (!canTransact.allowed) {
    // Record auto-debit failure
    this.autoDebit.failureCount += 1;
    this.autoDebit.lastFailureDate = paymentDate;
    this.autoDebit.lastFailureReason = canTransact.reason;
    await this.save();

    throw new Error(`Payment failed: ${canTransact.reason}`);
  }

  // Debit the account
  await fromAccount.debit(totalAmount, `RD Installment - ${this.rdNumber}`);

  // Create transaction
  const transaction = new Transaction({
    fromAccountId: this.fromAccountId,
    fromAccountNumber: fromAccount.accountNumber,
    amount: totalAmount,
    transactionType: "rd_deposit",
    description: `RD Installment payment for ${this.formattedRdNumber}${
      penaltyAmount > 0 ? ` (includes penalty: ₹${penaltyAmount})` : ""
    }`,
    reference: this.rdNumber,
    status: "completed",
    processedAt: paymentDate,
  });

  await transaction.save();

  // Create installment record
  const installment = new RDInstallment({
    rdId: this._id,
    installmentNumber: this.installmentsPaid + 1,
    amount: this.monthlyAmount,
    penaltyAmount,
    totalAmount,
    dueDate: this.nextDueDate,
    paidDate: paymentDate,
    status: "paid",
    transactionId: transaction._id,
  });

  await installment.save();

  // Update RD record
  this.totalDeposited += this.monthlyAmount;
  this.installmentsPaid += 1;
  this.penaltyAmount += penaltyAmount;
  this.autoDebit.failureCount = 0; // Reset failure count on successful payment

  // Calculate next due date
  const nextDue = new Date(this.nextDueDate);
  nextDue.setMonth(nextDue.getMonth() + 1);
  this.nextDueDate = nextDue;

  // Check if RD is completed
  if (this.installmentsPaid >= this.tenure) {
    await this.processMaturity();
  } else {
    await this.save();
  }

  return {
    success: true,
    installmentNumber: installment.installmentNumber,
    amountPaid: totalAmount,
    penaltyAmount,
    transactionId: transaction.transactionId,
    nextDueDate: this.nextDueDate,
  };
};

// Method to process RD maturity
recurringDepositSchema.methods.processMaturity = async function () {
  if (this.installmentsPaid < this.tenure) {
    throw new Error("RD has not completed all installments");
  }

  const Account = mongoose.model("Account");
  const Transaction = mongoose.model("Transaction");

  const fromAccount = await Account.findById(this.fromAccountId);
  if (!fromAccount) {
    throw new Error("Source account not found");
  }

  // Calculate actual maturity amount (may differ due to penalties or missed installments)
  const actualMaturityAmount = this.maturityAmount - this.penaltyAmount;
  const totalInterestEarned = actualMaturityAmount - this.totalDeposited;

  // Create transaction to credit maturity amount
  const transaction = new Transaction({
    toAccountId: this.fromAccountId,
    toAccountNumber: fromAccount.accountNumber,
    amount: actualMaturityAmount,
    transactionType: "rd_maturity",
    description: `Maturity of ${this.formattedRdNumber}`,
    reference: this.rdNumber,
    status: "completed",
    processedAt: new Date(),
  });

  await transaction.save();

  // Credit account
  await fromAccount.credit(
    actualMaturityAmount,
    `RD Maturity - ${this.rdNumber}`
  );

  // Update RD status
  this.status = "matured";
  this.maturityDetails = {
    processedDate: new Date(),
    creditedAccountId: this.fromAccountId,
    transactionId: transaction.transactionId,
    totalInterestEarned,
  };

  await this.save();

  return {
    success: true,
    maturityAmount: actualMaturityAmount,
    totalInterestEarned,
    transactionId: transaction.transactionId,
  };
};

// Method to close RD prematurely
recurringDepositSchema.methods.closePremature = async function (
  reason = "Customer request"
) {
  if (this.status !== "active") {
    throw new Error("RD is not active");
  }

  // Calculate premature closure amount (only principal + penalty)
  const penaltyPercentage = 1; // 1% penalty on total deposited
  const penaltyAmount = Math.round(
    (this.totalDeposited * penaltyPercentage) / 100
  );
  const netAmount = this.totalDeposited - penaltyAmount;

  const Account = mongoose.model("Account");
  const Transaction = mongoose.model("Transaction");

  const fromAccount = await Account.findById(this.fromAccountId);
  if (!fromAccount) {
    throw new Error("Source account not found");
  }

  // Create transaction to credit the net amount
  const transaction = new Transaction({
    toAccountId: this.fromAccountId,
    toAccountNumber: fromAccount.accountNumber,
    amount: netAmount,
    transactionType: "rd_maturity",
    description: `Premature closure of ${this.formattedRdNumber}`,
    reference: this.rdNumber,
    status: "completed",
    processedAt: new Date(),
  });

  await transaction.save();

  // Credit account
  await fromAccount.credit(
    netAmount,
    `RD Premature Closure - ${this.rdNumber}`
  );

  // Update RD status
  this.status = "closed";
  this.closureDetails = {
    closureDate: new Date(),
    reason,
    penaltyApplied: penaltyAmount,
    netAmount,
  };

  await this.save();

  return {
    success: true,
    netAmount,
    penaltyAmount,
    transactionId: transaction.transactionId,
  };
};

// Static method to find RDs by user
recurringDepositSchema.statics.findByUser = function (userId, status = null) {
  const query = { userId };
  if (status) {
    query.status = status;
  }

  return this.find(query)
    .populate("userId", "firstName lastName email")
    .populate("fromAccountId", "accountNumber accountType")
    .sort({ createdAt: -1 });
};

// Static method to find due RDs
recurringDepositSchema.statics.findDue = function (days = 0) {
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + days);

  return this.find({
    status: "active",
    nextDueDate: { $lte: targetDate },
  })
    .populate("userId", "firstName lastName email phone")
    .populate("fromAccountId", "accountNumber accountType balance");
};

// Static method to find overdue RDs
recurringDepositSchema.statics.findOverdue = function () {
  const today = new Date();

  return this.find({
    status: "active",
    nextDueDate: { $lt: today },
  })
    .populate("userId", "firstName lastName email phone")
    .populate("fromAccountId", "accountNumber accountType balance");
};

// Static method to process auto-debit for all due RDs
recurringDepositSchema.statics.processAutoDue = async function () {
  const dueRDs = await this.findDue(0);
  const results = [];

  for (const rd of dueRDs) {
    if (rd.autoDebit.enabled && rd.autoDebit.failureCount < 3) {
      try {
        const result = await rd.processInstallment();
        results.push({
          rdNumber: rd.rdNumber,
          status: "success",
          ...result,
        });
      } catch (error) {
        results.push({
          rdNumber: rd.rdNumber,
          status: "failed",
          error: error.message,
        });
      }
    }
  }

  return results;
};

// Static method for RD analytics
recurringDepositSchema.statics.getAnalytics = function (userId = null) {
  const matchStage = userId ? { userId: mongoose.Types.ObjectId(userId) } : {};

  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        totalMonthlyAmount: { $sum: "$monthlyAmount" },
        totalDeposited: { $sum: "$totalDeposited" },
        totalMaturityValue: { $sum: "$maturityAmount" },
        avgInterestRate: { $avg: "$interestRate" },
        avgTenure: { $avg: "$tenure" },
      },
    },
  ]);
};

export default mongoose.model("RecurringDeposit", recurringDepositSchema);
