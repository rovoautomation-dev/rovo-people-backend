import mongoose from 'mongoose';

// Salary Structure Schema
const salaryStructureSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Salary structure name is required'],
        trim: true
    },
    components: [{
        name: {
            type: String,
            required: true
        },
        type: {
            type: String,
            enum: ['Earning', 'Deduction'],
            required: true
        },
        calculationType: {
            type: String,
            enum: ['Fixed', 'Percentage'],
            required: true
        },
        value: {
            type: Number,
            required: true
        },
        basedOn: {
            type: String, // e.g., 'Basic', 'Gross' for percentage calculations
            default: 'Basic'
        },
        isTaxable: {
            type: Boolean,
            default: true
        }
    }],
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Payroll Schema
const payrollSchema = new mongoose.Schema({
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: [true, 'Employee is required']
    },
    month: {
        type: Number,
        required: [true, 'Month is required'],
        min: 1,
        max: 12
    },
    year: {
        type: Number,
        required: [true, 'Year is required']
    },
    basicSalary: {
        type: Number,
        required: true
    },
    earnings: [{
        name: {
            type: String,
            required: true
        },
        amount: {
            type: Number,
            required: true
        }
    }],
    deductions: [{
        name: {
            type: String,
            required: true
        },
        amount: {
            type: Number,
            required: true
        }
    }],
    grossSalary: {
        type: Number,
        required: true
    },
    totalDeductions: {
        type: Number,
        required: true
    },
    netSalary: {
        type: Number,
        required: true
    },
    workingDays: {
        type: Number,
        default: 0
    },
    presentDays: {
        type: Number,
        default: 0
    },
    leaveDays: {
        type: Number,
        default: 0
    },
    overtime: {
        hours: {
            type: Number,
            default: 0
        },
        amount: {
            type: Number,
            default: 0
        }
    },
    status: {
        type: String,
        enum: ['Draft', 'Pending', 'Processed', 'Paid'],
        default: 'Draft'
    },
    paymentDate: {
        type: Date
    },
    paymentMethod: {
        type: String,
        enum: ['Bank Transfer', 'Cheque', 'Cash'],
        default: 'Bank Transfer'
    },
    bankDetails: {
        bankName: String,
        accountNumber: String,
        ifscCode: String
    },
    processedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    notes: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

// Compound index for unique payroll per employee per month/year
payrollSchema.index({ employee: 1, month: 1, year: 1 }, { unique: true });

// Payslip Document Schema (for storing generated payslips)
const payslipSchema = new mongoose.Schema({
    payroll: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Payroll',
        required: true
    },
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: true
    },
    documentUrl: {
        type: String
    },
    documentPublicId: {
        type: String
    },
    generatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

export const SalaryStructure = mongoose.model('SalaryStructure', salaryStructureSchema);
export const Payroll = mongoose.model('Payroll', payrollSchema);
export const Payslip = mongoose.model('Payslip', payslipSchema);
