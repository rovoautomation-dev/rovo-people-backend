import mongoose from 'mongoose';

const biometricEmployeeSchema = new mongoose.Schema({
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: true
    },
    biometricEmployeeId: {
        type: String,
        required: [true, 'Biometric employee ID is required'],
        trim: true
    },
    hasFingerprint: {
        type: Boolean,
        default: false
    },
    fingerprintId: {
        type: String,
        default: null
    },
    fingerprintTemplate: {
        type: String,
        default: null
    }
}, {
    timestamps: true
});

// Compound index for unique biometric ID per system
biometricEmployeeSchema.index({ biometricEmployeeId: 1 }, { unique: true });
biometricEmployeeSchema.index({ employee: 1 }, { unique: true });

const BiometricEmployee = mongoose.model('BiometricEmployee', biometricEmployeeSchema);

export default BiometricEmployee;
