import mongoose from "mongoose";

const rdInstallmentSchema = new mongoose.Schema(
  {
    rdId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RecurringDeposit",
      required: [true, "RD ID is required"],
      index: true,
    },
    installmentNumber: {
      type: Number,
      required: [true, "Installment number is required"],
      min: [1, "Installment number must be at least 1"],
    },
    amount: {
      type: Number,
      required: [true, "Installment amount is required"],
      min: [0.01, "Amount must be greater than 0"],
    },
    penaltyAmount: {
      type: Number,
      default: 0,
      min: [0, "Penalty amount cannot be negative"],
    },
    totalAmount: {
      type: Number,
      required: true,
      min: [0.01, "Total amount must be greater than 0"],
    },
    dueDate: {
      type: Date,
      required: [true, "Due date is required"],
      index: true,
    },
    paidDate: {
      type: Date,
      index: true,
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "paid", "overdue", "defaulted"],
      default: "pending",
      index: true,
    },
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      default: null,
    },
    paymentMethod: {
      type: String,
      enum: ["auto_debit", "manual", "cash", "cheque", "online"],
      default: "auto_debit",
    },
    notes: {
      type: String,
      maxlength: [500, "Notes cannot exceed 500 characters"],
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for formatted amounts
rdInstallmentSchema.virtual("formattedAmount").get(function () {
  return `₹${this.amount.toLocaleString("en-IN")}`;
});

rdInstallmentSchema.virtual("formattedPenaltyAmount").get(function () {
  return `₹${this.penaltyAmount.toLocaleString("en-IN")}`;
});

rdInstallmentSchema.virtual("formattedTotalAmount").get(function () {
  return `₹${this.totalAmount.toLocaleString("en-IN")}`;
});

// Virtual for overdue status
rdInstallmentSchema.virtual("isOverdue").get(function () {
  return this.status === "pending" && new Date() > new Date(this.dueDate);
});

// Virtual for days overdue
rdInstallmentSchema.virtual("daysOverdue").get(function () {
  if (this.status !== "pending") return 0;
  const now = new Date();
  const due = new Date(this.dueDate);
  if (now <= due) return 0;
  return Math.floor((now - due) / (1000 * 60 * 60 * 24));
});

// Virtual for days until due
rdInstallmentSchema.virtual("daysUntilDue").get(function () {
  if (this.status !== "pending") return 0;
  const now = new Date();
  const due = new Date(this.dueDate);
  const diffTime = due - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
});

// Compound index for better performance
rdInstallmentSchema.index({ rdId: 1, installmentNumber: 1 }, { unique: true });
rdInstallmentSchema.index({ status: 1, dueDate: 1 });
rdInstallmentSchema.index({ paidDate: 1 });

// Pre-save middleware to calculate total amount
rdInstallmentSchema.pre("save", function (next) {
  if (
    this.isModified("amount") ||
    this.isModified("penaltyAmount") ||
    this.isNew
  ) {
    this.totalAmount = this.amount + this.penaltyAmount;
  }
  next();
});

// Method to mark installment as paid
rdInstallmentSchema.methods.markAsPaid = function (
  transactionId,
  paymentMethod = "auto_debit",
  paymentDate = new Date()
) {
  this.status = "paid";
  this.paidDate = paymentDate;
  this.transactionId = transactionId;
  this.paymentMethod = paymentMethod;
  return this.save();
};

// Method to mark installment as overdue
rdInstallmentSchema.methods.markAsOverdue = function () {
  if (this.status === "pending" && new Date() > new Date(this.dueDate)) {
    this.status = "overdue";
    return this.save();
  }
  return Promise.resolve(this);
};

// Method to mark installment as defaulted
rdInstallmentSchema.methods.markAsDefaulted = function (reason) {
  this.status = "defaulted";
  this.notes = reason;
  return this.save();
};

// Static method to find installments by RD
rdInstallmentSchema.statics.findByRD = function (rdId, status = null) {
  const query = { rdId };
  if (status) {
    query.status = status;
  }

  return this.find(query)
    .populate("rdId", "rdNumber monthlyAmount")
    .populate("transactionId")
    .sort({ installmentNumber: 1 });
};

// Static method to find overdue installments
rdInstallmentSchema.statics.findOverdue = function (daysOverdue = 0) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOverdue);

  return this.find({
    status: "pending",
    dueDate: { $lte: cutoffDate },
  })
    .populate("rdId", "rdNumber userId fromAccountId autoDebit")
    .populate({
      path: "rdId",
      populate: {
        path: "userId",
        select: "firstName lastName email phone",
      },
    });
};

// Static method to find due installments
rdInstallmentSchema.statics.findDue = function (days = 0) {
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + days);

  return this.find({
    status: "pending",
    dueDate: { $lte: targetDate },
  })
    .populate("rdId", "rdNumber userId fromAccountId autoDebit")
    .populate({
      path: "rdId",
      populate: {
        path: "userId",
        select: "firstName lastName email phone",
      },
    });
};

// Static method to get installment statistics
rdInstallmentSchema.statics.getStats = function (rdId = null, period = "30d") {
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

  const matchStage = {
    createdAt: { $gte: startDate },
  };

  if (rdId) {
    matchStage.rdId = mongoose.Types.ObjectId(rdId);
  }

  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        totalAmount: { $sum: "$totalAmount" },
        totalPenalty: { $sum: "$penaltyAmount" },
        avgAmount: { $avg: "$amount" },
      },
    },
    {
      $sort: { totalAmount: -1 },
    },
  ]);
};

// Static method to create installment schedule for a new RD
rdInstallmentSchema.statics.createSchedule = async function (
  rdId,
  monthlyAmount,
  startDate,
  tenure
) {
  const installments = [];
  const currentDate = new Date(startDate);

  for (let i = 1; i <= tenure; i++) {
    const installment = {
      rdId,
      installmentNumber: i,
      amount: monthlyAmount,
      penaltyAmount: 0,
      totalAmount: monthlyAmount,
      dueDate: new Date(currentDate),
      status: "pending",
    };

    installments.push(installment);

    // Move to next month
    currentDate.setMonth(currentDate.getMonth() + 1);
  }

  return await this.insertMany(installments);
};

// Static method to update overdue installments
rdInstallmentSchema.statics.updateOverdueStatus = async function () {
  const today = new Date();

  const result = await this.updateMany(
    {
      status: "pending",
      dueDate: { $lt: today },
    },
    {
      $set: { status: "overdue" },
    }
  );

  return result;
};

// Static method for payment reminders
rdInstallmentSchema.statics.getPaymentReminders = function (days = 3) {
  const reminderDate = new Date();
  reminderDate.setDate(reminderDate.getDate() + days);

  return this.find({
    status: "pending",
    dueDate: {
      $gte: new Date(),
      $lte: reminderDate,
    },
  })
    .populate({
      path: "rdId",
      populate: {
        path: "userId",
        select: "firstName lastName email phone",
      },
      select: "rdNumber monthlyAmount",
    })
    .sort({ dueDate: 1 });
};

export default mongoose.model("RDInstallment", rdInstallmentSchema);
