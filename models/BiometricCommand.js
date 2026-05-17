import mongoose from 'mongoose';

const biometricCommandSchema = new mongoose.Schema({
    deviceSerialNumber: {
        type: String,
        required: true,
        uppercase: true
    },
    commandId: {
        type: String,
        default: null
    },
    command: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['CREATEUSER', 'DELETEUSER', 'QUERYUSER'],
        required: true
    },
    employeeId: {
        type: String,
        default: null,
        comment: 'Biometric employee ID on device'
    },
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        default: null
    },
    status: {
        type: String,
        enum: ['pending', 'sent', 'executed', 'failed'],
        default: 'pending'
    },
    sentAt: {
        type: Date,
        default: null
    },
    executedAt: {
        type: Date,
        default: null
    },
    failedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

biometricCommandSchema.index({ deviceSerialNumber: 1, status: 1 });
biometricCommandSchema.index({ commandId: 1 });

// Static: Generate CREATEUSER command string
biometricCommandSchema.statics.createUserCommand = function (commandId, pin, name) {
    const cid = `CREATEUSER-${commandId}`;
    return `C:${cid}:DATA USER PIN=${pin}\tName=${name}\n`;
};

// Static: Generate DELETEUSER command string
biometricCommandSchema.statics.deleteUserCommand = function (commandId, pin) {
    const cid = `DELETEUSER-${commandId}`;
    return `C:${cid}:DATA DELETE USERINFO PIN=${pin}\n`;
};

// Static: Generate QUERYUSER command string
biometricCommandSchema.statics.queryUserCommand = function (commandId, pin) {
    const cid = `QUERYUSER-${commandId}`;
    return `C:${cid}:DATA QUERY USERINFO PIN=${pin}\n`;
};

// Static: Convert timezone string to minutes offset
biometricCommandSchema.statics.timezoneToMinutes = function (timezone) {
    try {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone || 'Asia/Kolkata',
            timeZoneName: 'shortOffset'
        });
        const parts = formatter.formatToParts(now);
        const tzPart = parts.find(p => p.type === 'timeZoneName');
        if (tzPart) {
            const match = tzPart.value.match(/GMT([+-]?\d+):?(\d+)?/);
            if (match) {
                const hours = parseInt(match[1]) || 0;
                const minutes = parseInt(match[2]) || 0;
                return hours * 60 + (hours >= 0 ? minutes : -minutes);
            }
        }
        return 330; // Default IST
    } catch (error) {
        console.error('Error converting timezone to minutes:', error);
        return 330; // Default IST
    }
};

const BiometricCommand = mongoose.model('BiometricCommand', biometricCommandSchema);

export default BiometricCommand;
