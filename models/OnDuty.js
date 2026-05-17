import mongoose from 'mongoose';

// Location History Schema - Stores cumulative time at each location
const locationHistorySchema = new mongoose.Schema({
    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number], // [longitude, latitude]
            required: true
        }
    },
    address: {
        type: String,
        trim: true
    },
    startTime: {
        type: Date,
        required: true
    },
    endTime: {
        type: Date,
        required: true
    },
    durationMinutes: {
        type: Number,
        default: 0
    }
});

// On-Duty Request Schema
const onDutyRequestSchema = new mongoose.Schema({
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: [true, 'Employee is required']
    },
    date: {
        type: Date,
        required: [true, 'Date is required']
    },
    purpose: {
        type: String,
        required: [true, 'Purpose is required'],
        trim: true
    },
    expectedLocation: {
        type: String,
        required: [true, 'Expected location is required'],
        trim: true
    },
    clientName: {
        type: String,
        trim: true
    },
    startTime: {
        type: Date,
        required: [true, 'Start time is required']
    },
    endTime: {
        type: Date,
        required: [true, 'End time is required']
    },
    expectedDurationMinutes: {
        type: Number,
        default: 480 // 8 hours default
    },
    // Approval status for paid leave
    status: {
        type: String,
        enum: ['Pending', 'Approved', 'Rejected'],
        default: 'Pending'
    },
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedAt: {
        type: Date
    },
    rejectionReason: {
        type: String,
        trim: true
    },
    // Tracking status
    trackingStatus: {
        type: String,
        enum: ['Not Started', 'Active', 'Paused', 'Completed'],
        default: 'Not Started'
    },
    trackingStartedAt: {
        type: Date
    },
    trackingEndedAt: {
        type: Date
    },
    // Location history - cumulative data
    locationHistory: [locationHistorySchema],
    // Last known location for real-time tracking
    lastLocation: {
        coordinates: {
            type: [Number] // [longitude, latitude]
        },
        address: String,
        timestamp: Date
    },
    // Calculated metrics
    totalTrackedMinutes: {
        type: Number,
        default: 0
    },
    // Effective attendance based on tracked time
    effectiveAttendance: {
        type: String,
        enum: ['Full Day', 'Half Day', 'Absent', 'Pending'],
        default: 'Pending'
    },
    // Location permission history - stores enable/disable events
    locationPermissionHistory: [{
        event: {
            type: String,
            enum: ['disabled', 'enabled', 'denied', 'granted'],
            required: true
        },
        timestamp: {
            type: Date,
            default: Date.now
        },
        location: {
            type: {
                type: String,
                enum: ['Point'],
                default: 'Point'
            },
            coordinates: [Number] // [longitude, latitude] - location when event occurred
        },
        address: String,
        deviceInfo: {
            platform: String, // 'web', 'android', 'ios'
            appVersion: String,
            userAgent: String
        },
        notifiedManagers: [{
            managerId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User'
            },
            notifiedAt: Date,
            notificationMethod: String // 'push', 'email', 'in-app'
        }],
        resolved: {
            type: Boolean,
            default: false
        },
        resolvedAt: Date
    }],
    // Last permission status
    lastPermissionStatus: {
        type: String,
        enum: ['granted', 'denied', 'disabled', 'unknown'],
        default: 'unknown'
    },
    notes: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

// Calculate expected duration before saving
onDutyRequestSchema.pre('save', function (next) {
    if (this.startTime && this.endTime) {
        const diffMs = new Date(this.endTime) - new Date(this.startTime);
        this.expectedDurationMinutes = Math.round(diffMs / (1000 * 60));
    }
    next();
});

// Calculate effective attendance based on tracked time
onDutyRequestSchema.methods.calculateEffectiveAttendance = function () {
    const expectedMinutes = this.expectedDurationMinutes || 480;
    const trackedMinutes = this.totalTrackedMinutes;
    const percentage = (trackedMinutes / expectedMinutes) * 100;

    if (percentage >= 83) {
        this.effectiveAttendance = 'Full Day';
    } else if (percentage >= 42) {
        this.effectiveAttendance = 'Half Day';
    } else {
        this.effectiveAttendance = 'Absent';
    }

    return this.effectiveAttendance;
};

// Method to add or update location (smart aggregation)
onDutyRequestSchema.methods.updateLocation = function (coordinates, address, timestamp) {
    const DISTANCE_THRESHOLD_KM = 0.2; // 200 meters

    // Helper function to calculate distance between two points (Haversine formula)
    const calculateDistance = (coord1, coord2) => {
        const R = 6371; // Earth's radius in km
        const dLat = (coord2[1] - coord1[1]) * Math.PI / 180;
        const dLon = (coord2[0] - coord1[0]) * Math.PI / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(coord1[1] * Math.PI / 180) * Math.cos(coord2[1] * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    };

    // Update last known location
    this.lastLocation = {
        coordinates: coordinates,
        address: address,
        timestamp: timestamp
    };

    // Check if we have existing location history
    if (this.locationHistory.length === 0) {
        // First location entry
        this.locationHistory.push({
            location: {
                type: 'Point',
                coordinates: coordinates
            },
            address: address,
            startTime: timestamp,
            endTime: timestamp,
            durationMinutes: 0
        });
    } else {
        // Get the last location entry
        const lastEntry = this.locationHistory[this.locationHistory.length - 1];
        const distance = calculateDistance(lastEntry.location.coordinates, coordinates);

        if (distance <= DISTANCE_THRESHOLD_KM) {
            // Same location - extend the end time
            lastEntry.endTime = timestamp;
            lastEntry.durationMinutes = Math.round(
                (new Date(timestamp) - new Date(lastEntry.startTime)) / (1000 * 60)
            );
        } else {
            // New location - create new entry
            this.locationHistory.push({
                location: {
                    type: 'Point',
                    coordinates: coordinates
                },
                address: address,
                startTime: timestamp,
                endTime: timestamp,
                durationMinutes: 0
            });
        }
    }

    // Recalculate total tracked minutes
    this.totalTrackedMinutes = this.locationHistory.reduce((total, entry) => {
        return total + (entry.durationMinutes || 0);
    }, 0);

    // Add 5 minutes for the current ping if duration is 0
    if (this.locationHistory.length > 0) {
        const lastEntry = this.locationHistory[this.locationHistory.length - 1];
        if (lastEntry.durationMinutes === 0) {
            this.totalTrackedMinutes += 5;
        }
    }
};

// Index for geospatial queries
onDutyRequestSchema.index({ 'lastLocation.coordinates': '2dsphere' });
onDutyRequestSchema.index({ employee: 1, date: 1 });
onDutyRequestSchema.index({ trackingStatus: 1 });
onDutyRequestSchema.index({ status: 1 });

const OnDutyRequest = mongoose.model('OnDutyRequest', onDutyRequestSchema);

export default OnDutyRequest;
