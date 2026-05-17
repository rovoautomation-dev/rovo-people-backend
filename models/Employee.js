import mongoose from 'mongoose';

const employeeSchema = new mongoose.Schema({
    employeeId: {
        type: String,
        unique: true,
        required: true
    },
    firstName: {
        type: String,
        required: [true, 'First name is required'],
        trim: true
    },
    lastName: {
        type: String,
        required: [true, 'Last name is required'],
        trim: true
    },
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
    },
    phone: {
        type: String,
        required: [true, 'Phone number is required'],
        trim: true
    },
    biometricId: {
        type: String,
        trim: true,
        sparse: true, // Allows null/undefined but enforces uniqueness when present
        index: true
    },
    dateOfBirth: {
        type: Date
    },
    gender: {
        type: String,
        enum: ['Male', 'Female', 'Other', 'Prefer not to say']
    },
    department: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Department',
        required: [true, 'Department is required']
    },
    designation: {
        type: String,
        required: [true, 'Designation is required'],
        trim: true
    },
    isManager: {
        type: Boolean,
        default: false
    },
    dateOfJoining: {
        type: Date,
        required: [true, 'Date of joining is required']
    },
    salary: {
        type: Number,
        min: 0
    },
    salaryStructure: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SalaryStructure'
    },
    employmentType: {
        type: String,
        enum: ['Full-time', 'Part-time', 'Contract', 'Intern'],
        default: 'Full-time'
    },
    reportingManager: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee'
    },
    address: {
        street: String,
        city: String,
        state: String,
        zipCode: String,
        country: { type: String, default: 'India' }
    },
    emergencyContact: {
        name: String,
        relationship: String,
        phone: String
    },
    profileImage: {
        url: String,
        publicId: String
    },
    status: {
        type: String,
        enum: ['Active', 'Inactive', 'On Leave', 'Terminated'],
        default: 'Active'
    },
    documents: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Document'
    }],
    notes: {
        type: String
    }
}, {
    timestamps: true
});

// Generate unique employee ID before validation (so it exists when validation runs)
employeeSchema.pre('validate', async function (next) {
    if (this.isNew && !this.employeeId) {
        // Find the employee with the highest employeeId
        const lastEmployee = await mongoose.model('Employee')
            .findOne({}, { employeeId: 1 })
            .sort({ employeeId: -1 });

        let nextIdNumber = 1001;
        if (lastEmployee && lastEmployee.employeeId) {
            // Extract the numeric part from IDs like "EMP01001"
            const match = lastEmployee.employeeId.match(/\d+/);
            if (match) {
                nextIdNumber = parseInt(match[0], 10) + 1;
            }
        }

        this.employeeId = `EMP${String(nextIdNumber).padStart(5, '0')}`;
    }
    next();
});

// Virtual for full name
employeeSchema.virtual('fullName').get(function () {
    return `${this.firstName} ${this.lastName}`;
});

// Ensure virtuals are included in JSON output
employeeSchema.set('toJSON', { virtuals: true });
employeeSchema.set('toObject', { virtuals: true });

const Employee = mongoose.model('Employee', employeeSchema);

export default Employee;
